-- Ventes, dividendes et bilan fiscal annuel (voir docs/superpowers/specs/2026-11-11-ventes-dividendes-fiscal-design.md).

create table public.operations (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references public.manual_accounts on delete cascade,
  instrument_id uuid references public.instruments,
  kind          text not null check (kind in ('sell', 'dividend', 'withholding')),
  date          date not null,
  quantity      numeric,                       -- ventes
  price         numeric,                       -- prix de vente unitaire
  fees          numeric not null default 0,
  amount        numeric,                       -- dividende brut, ou retenue (négative)
  tax_withheld  numeric not null default 0,    -- impôt déjà prélevé par un courtier français
  currency      text not null,
  avg_cost      numeric,                       -- PRU au moment de la vente (figé)
  realized      numeric,                       -- plus-value réalisée, dans `currency`
  fx_per_eur    numeric not null default 1,    -- 1 EUR = fx_per_eur `currency` au jour de l'opération
  cash_credit   numeric not null default 0,    -- ajouté aux liquidités du compte (devise du compte)
  source        text not null default 'manual' check (source in ('manual', 'ibkr')),
  external_id   text,
  note          text,
  created_at    timestamptz not null default now(),
  unique (source, external_id)
);
create index operations_account_date on public.operations (account_id, date desc);

create table public.tax_settings (
  year           int primary key,
  pfu_rate       numeric not null default 0.314,
  carried_losses numeric not null default 0     -- moins-values reportables des années antérieures (€)
);

do $$
declare t text;
begin
  foreach t in array array['operations', 'tax_settings'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('create policy "proprietaire" on public.%I for all to authenticated
                    using (public.is_app_user()) with check (public.is_app_user())', t);
  end loop;
end $$;

-- Conversion entre devises via fx_rates (null si un taux manque).
create function public.fx_convert(p_amount numeric, p_from text, p_to text) returns numeric
language sql stable set search_path = '' as $$
  select case when p_from = p_to then p_amount
    else p_amount / (select per_eur from public.fx_rates where currency = p_from)
                  * (select per_eur from public.fx_rates where currency = p_to) end;
$$;

-- Vente (tout ou partie) d'une position manuelle : opération + position + liquidités, en une fois.
create function public.sell_position(p_position uuid, p_quantity numeric, p_price numeric, p_fees numeric, p_date date)
returns uuid language plpgsql set search_path = '' as $$
declare
  pos record; acc record; v_fx numeric; v_credit numeric; v_id uuid;
  v_fees numeric := coalesce(p_fees, 0);
begin
  select * into pos from public.positions where id = p_position for update;
  if not found then raise exception 'Position introuvable.'; end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'Quantité invalide.'; end if;
  if p_quantity > pos.quantity then
    raise exception 'Quantité vendue supérieure à la quantité détenue (%).', pos.quantity;
  end if;
  if p_price is null or p_price < 0 or v_fees < 0 then raise exception 'Prix ou frais invalides.'; end if;

  select * into acc from public.manual_accounts where id = pos.account_id for update;
  if acc.sync_source is not null then raise exception 'Compte synchronisé : ses ventes viennent de la synchro.'; end if;

  v_fx := (select per_eur from public.fx_rates where currency = pos.cost_currency);
  v_credit := public.fx_convert(p_quantity * p_price - v_fees, pos.cost_currency, acc.currency);
  if v_fx is null or v_credit is null then raise exception 'Taux de change indisponible (%).', pos.cost_currency; end if;

  insert into public.operations (account_id, instrument_id, kind, date, quantity, price, fees, currency,
                                 avg_cost, realized, fx_per_eur, cash_credit)
  values (pos.account_id, pos.instrument_id, 'sell', p_date, p_quantity, p_price, v_fees, pos.cost_currency,
          pos.avg_cost, (p_price - pos.avg_cost) * p_quantity - v_fees, v_fx, round(v_credit, 2))
  returning id into v_id;

  if pos.quantity = p_quantity then
    delete from public.positions where id = p_position;
  else
    update public.positions set quantity = quantity - p_quantity, updated_at = now() where id = p_position;
  end if;
  update public.manual_accounts set cash_balance = cash_balance + round(v_credit, 2), cash_updated_at = current_date
  where id = acc.id;
  return v_id;
end $$;

-- Dividende manuel : les liquidités reçoivent le net (brut − impôt déjà prélevé).
create function public.add_dividend(p_account uuid, p_instrument uuid, p_date date, p_amount numeric,
                                    p_tax_withheld numeric, p_currency text, p_note text)
returns uuid language plpgsql set search_path = '' as $$
declare acc record; v_fx numeric; v_credit numeric; v_id uuid; v_tax numeric := coalesce(p_tax_withheld, 0);
begin
  if p_amount is null or p_amount <= 0 then raise exception 'Montant invalide.'; end if;
  if v_tax < 0 or v_tax > p_amount then raise exception 'Impôt prélevé invalide.'; end if;
  select * into acc from public.manual_accounts where id = p_account for update;
  if not found then raise exception 'Compte introuvable.'; end if;
  if acc.sync_source is not null then raise exception 'Compte synchronisé : ses dividendes viennent de la synchro.'; end if;

  v_fx := (select per_eur from public.fx_rates where currency = p_currency);
  v_credit := public.fx_convert(p_amount - v_tax, p_currency, acc.currency);
  if v_fx is null or v_credit is null then raise exception 'Taux de change indisponible (%).', p_currency; end if;

  insert into public.operations (account_id, instrument_id, kind, date, amount, tax_withheld, currency,
                                 fx_per_eur, cash_credit, note)
  values (p_account, p_instrument, 'dividend', p_date, p_amount, v_tax, p_currency, v_fx, round(v_credit, 2), p_note)
  returning id into v_id;
  update public.manual_accounts set cash_balance = cash_balance + round(v_credit, 2), cash_updated_at = current_date
  where id = p_account;
  return v_id;
end $$;

-- Annulation d'une opération manuelle : rend les titres (vente) et reprend ce qui avait été crédité.
create function public.delete_operation(p_op uuid) returns void
language plpgsql set search_path = '' as $$
declare op record; pos record;
begin
  select * into op from public.operations where id = p_op for update;
  if not found then raise exception 'Opération introuvable.'; end if;
  if op.source <> 'manual' then raise exception 'Seules les opérations manuelles peuvent être supprimées.'; end if;

  if op.kind = 'sell' and op.instrument_id is not null then
    select * into pos from public.positions
    where account_id = op.account_id and instrument_id = op.instrument_id for update;
    if found then
      update public.positions
      set avg_cost = (pos.quantity * pos.avg_cost + op.quantity * op.avg_cost) / (pos.quantity + op.quantity),
          quantity = pos.quantity + op.quantity, updated_at = now()
      where id = pos.id;
    else
      insert into public.positions (account_id, instrument_id, quantity, avg_cost, cost_currency)
      values (op.account_id, op.instrument_id, op.quantity, op.avg_cost, op.currency);
    end if;
  end if;

  update public.manual_accounts set cash_balance = cash_balance - op.cash_credit where id = op.account_id;
  delete from public.operations where id = p_op;
end $$;

-- Opérations lisibles par l'app (montants en EUR).
create view public.operation_view with (security_invoker = true) as
select o.*, i.name as instrument_name, a.name as account_name, a.envelope,
       round(o.realized / o.fx_per_eur, 2) as realized_eur,
       round(o.amount / o.fx_per_eur, 2) as amount_eur
from public.operations o
join public.manual_accounts a on a.id = o.account_id
left join public.instruments i on i.id = o.instrument_id;

-- Bilan fiscal estimé d'une année (montants EUR). CTO imposables ; PEA indicatif.
create function public.tax_summary(p_year int)
returns table (year int, pfu_rate numeric, cto_gains numeric, cto_losses numeric, cto_net numeric,
               carried_losses numeric, taxable numeric, loss_to_carry numeric, cto_dividends numeric,
               foreign_withholding numeric, already_withheld numeric, estimated_tax numeric, remaining numeric,
               pea_realized numeric, pea_dividends numeric)
language sql stable set search_path = '' as $$
  with s as (
    select coalesce((select t.pfu_rate from public.tax_settings t where t.year = p_year), 0.314) as r,
           coalesce((select t.carried_losses from public.tax_settings t where t.year = p_year), 0) as cl
  ),
  o as (
    select o.*, a.envelope from public.operations o
    join public.manual_accounts a on a.id = o.account_id
    where extract(year from o.date) = p_year
  ),
  g as (
    select
      coalesce(sum(realized / fx_per_eur) filter (where envelope = 'cto' and kind = 'sell' and realized > 0), 0) as gains,
      coalesce(sum(realized / fx_per_eur) filter (where envelope = 'cto' and kind = 'sell' and realized < 0), 0) as losses,
      coalesce(sum(amount / fx_per_eur) filter (where envelope = 'cto' and kind = 'dividend'), 0) as divs,
      coalesce(sum(-amount / fx_per_eur) filter (where envelope = 'cto' and kind = 'withholding'), 0) as fw,
      coalesce(sum(tax_withheld / fx_per_eur) filter (where envelope = 'cto' and kind = 'dividend'), 0) as aw,
      coalesce(sum(realized / fx_per_eur) filter (where envelope in ('pea', 'pea_pme') and kind = 'sell'), 0) as pea_r,
      coalesce(sum(amount / fx_per_eur) filter (where envelope in ('pea', 'pea_pme') and kind = 'dividend'), 0) as pea_d
    from o
  ),
  c as (select g.*, s.r, s.cl, g.gains + g.losses - s.cl as after_carry from g, s)
  select p_year, c.r, round(c.gains, 2), round(c.losses, 2), round(c.gains + c.losses, 2), c.cl,
         round(greatest(0, c.after_carry), 2), round(greatest(0, -c.after_carry), 2),
         round(c.divs, 2), round(c.fw, 2), round(c.aw, 2),
         round((greatest(0, c.after_carry) + c.divs) * c.r, 2),
         round((greatest(0, c.after_carry) + c.divs) * c.r, 2) - round(c.aw, 2),
         round(c.pea_r, 2), round(c.pea_d, 2)
  from c;
$$;

grant select on public.operation_view to authenticated;
revoke execute on function public.fx_convert(numeric, text, text) from public, anon;
revoke execute on function public.sell_position(uuid, numeric, numeric, numeric, date) from public, anon;
revoke execute on function public.add_dividend(uuid, uuid, date, numeric, numeric, text, text) from public, anon;
revoke execute on function public.delete_operation(uuid) from public, anon;
revoke execute on function public.tax_summary(int) from public, anon;
grant execute on function public.fx_convert(numeric, text, text) to authenticated, service_role;
grant execute on function public.sell_position(uuid, numeric, numeric, numeric, date) to authenticated, service_role;
grant execute on function public.add_dividend(uuid, uuid, date, numeric, numeric, text, text) to authenticated, service_role;
grant execute on function public.delete_operation(uuid) to authenticated, service_role;
grant execute on function public.tax_summary(int) to authenticated, service_role;
