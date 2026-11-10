<#
  Test Open Banking via Enable Banking (https://enablebanking.com)

  Prérequis (variables d'environnement) :
    EB_APP_ID     = UUID de l'application (Control Panel Enable Banking)
    EB_KEY_PATH   = chemin du fichier .pem (clé privée de l'application)
    EB_REDIRECT   = redirect URL déclarée dans l'app (défaut : https://localhost/callback)

  Usage :
    .\eb.ps1 check                                  # quelles banques sont dispo ?
    .\eb.ps1 auth -Bank "BNP Paribas" -Country FR   # donne l'URL de connexion bancaire
    .\eb.ps1 session -Code "<url de retour ou code>" # finalise et sauvegarde la session
    .\eb.ps1 tx [-Days 30]                          # soldes + transactions de tous les comptes liés
#>
param(
  [Parameter(Position = 0, Mandatory)][ValidateSet('check', 'list', 'auth', 'session', 'tx')][string]$Cmd,
  [string]$Bank,
  [string]$Country = 'FR',
  [string]$Code,
  [int]$Days = 30
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$Api      = 'https://api.enablebanking.com'
$OpenSsl  = 'C:\Program Files\Git\mingw64\bin\openssl.exe'
$AppId    = $env:EB_APP_ID
$KeyPath  = $env:EB_KEY_PATH
$Redirect = if ($env:EB_REDIRECT) { $env:EB_REDIRECT } else { 'https://localhost/callback' }
$Store    = Join-Path $PSScriptRoot 'sessions.json'

if (-not $AppId -or -not $KeyPath) { throw 'Définis EB_APP_ID et EB_KEY_PATH.' }

function B64Url([byte[]]$b) { [Convert]::ToBase64String($b).TrimEnd('=').Replace('+', '-').Replace('/', '_') }

function New-Jwt {
  $now = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
  $h = @{ typ = 'JWT'; alg = 'RS256'; kid = $AppId } | ConvertTo-Json -Compress
  $p = @{ iss = 'enablebanking.com'; aud = 'api.enablebanking.com'; iat = $now; exp = $now + 3600 } | ConvertTo-Json -Compress
  $signingInput = (B64Url ([Text.Encoding]::UTF8.GetBytes($h))) + '.' + (B64Url ([Text.Encoding]::UTF8.GetBytes($p)))
  $in = [IO.Path]::GetTempFileName(); $out = [IO.Path]::GetTempFileName()
  try {
    [IO.File]::WriteAllText($in, $signingInput)
    & $OpenSsl dgst -sha256 -sign $KeyPath -out $out $in
    if ($LASTEXITCODE -ne 0) { throw 'Signature JWT échouée (clé privée ?)' }
    "$signingInput." + (B64Url ([IO.File]::ReadAllBytes($out)))
  } finally { Remove-Item $in, $out -ErrorAction SilentlyContinue }
}

function Call($Method, $Path, $Body) {
  $args = @{ Method = $Method; Uri = "$Api$Path"; Headers = @{ Authorization = "Bearer $(New-Jwt)" } }
  if ($Body) {
    $args.ContentType = 'application/json; charset=utf-8'
    $args.Body = [Text.Encoding]::UTF8.GetBytes(($Body | ConvertTo-Json -Depth 10 -Compress))
  }
  # Invoke-RestMethod (PS 5.1) décode les réponses en Latin-1 : on relit les octets en UTF-8.
  try {
    $resp = Invoke-WebRequest @args -UseBasicParsing
    $ms = New-Object IO.MemoryStream
    $resp.RawContentStream.Position = 0; $resp.RawContentStream.CopyTo($ms)
    [Text.Encoding]::UTF8.GetString($ms.ToArray()) | ConvertFrom-Json
  }
  catch {
    $msg = $_.ErrorDetails.Message
    throw "HTTP $Method $Path -> $($_.Exception.Message) $msg"
  }
}

switch ($Cmd) {

  'list' {
    $all = (Call GET '/aspsps').aspsps
    "Pays : " + (($all | Group-Object country | Sort-Object Name | ForEach-Object { "$($_.Name)=$($_.Count)" }) -join ' ')
    "`n$Country :"
    $all | Where-Object country -eq $Country | ForEach-Object { "  $($_.name)" }
  }

  'check' {
    $wanted = [ordered]@{
      'BNP Paribas'          = 'bnp'
      'Société Générale'     = 'soci.t. g.n.rale|^sg$'
      'Revolut'              = 'revolut'
      'Trade Republic'       = 'trade ?republic'
      'Fortuneo'             = 'fortuneo'
      'Natixis Interépargne' = 'natixis|inter.?.pargne'
    }
    $all = (Call GET '/aspsps').aspsps
    "{0} banques disponibles au total sur Enable Banking`n" -f $all.Count
    foreach ($k in $wanted.Keys) {
      $hits = $all | Where-Object { $_.name -match $wanted[$k] }
      if (-not $hits) { "[ ABSENT ] $k"; continue }
      foreach ($a in $hits) {
        $days = if ($a.maximum_consent_validity) { [math]::Round($a.maximum_consent_validity / 86400) } else { '?' }
        "[  OK  ] {0,-22} -> '{1}' ({2}) psu={3} consentement max={4} j" -f $k, $a.name, $a.country, ($a.psu_types -join ','), $days
      }
    }
  }

  'auth' {
    if (-not $Bank) { throw '-Bank requis (nom exact affiché par check)' }
    $aspsp = (Call GET "/aspsps?country=$Country").aspsps | Where-Object { $_.name -eq $Bank } | Select-Object -First 1
    if (-not $aspsp) { throw "Banque '$Bank' introuvable en $Country" }
    $maxSec = if ($aspsp.maximum_consent_validity) { [int]$aspsp.maximum_consent_validity } else { 90 * 86400 }
    $validUntil = [DateTime]::UtcNow.AddSeconds([math]::Min($maxSec, 90 * 86400) - 60).ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
    $r = Call POST '/auth' @{
      access       = @{ valid_until = $validUntil }
      aspsp        = @{ name = $Bank; country = $Country }
      state        = [guid]::NewGuid().ToString()
      redirect_url = $Redirect
      psu_type     = 'personal'
    }
    "Ouvre cette URL, connecte-toi à ta banque, puis copie l'URL complète de la page de retour :`n"
    $r.url
  }

  'session' {
    if (-not $Code) { throw '-Code requis' }
    if ($Code -match '[?&]code=([^&]+)') { $Code = [uri]::UnescapeDataString($Matches[1]) }
    $s = Call POST '/sessions' @{ code = $Code }
    $list = @(); if (Test-Path $Store) { $list = @(Get-Content $Store -Raw | ConvertFrom-Json) }
    $list += [pscustomobject]@{ session_id = $s.session_id; bank = $s.aspsp.name; country = $s.aspsp.country; valid_until = $s.access.valid_until; accounts = @($s.accounts | ForEach-Object { $_.uid }) }
    ConvertTo-Json @($list) -Depth 5 | Set-Content $Store -Encoding UTF8
    "Session OK : {0} - {1} compte(s), valide jusqu'au {2}" -f $s.aspsp.name, @($s.accounts).Count, $s.access.valid_until
  }

  'tx' {
    if (-not (Test-Path $Store)) { throw 'Aucune session. Lance auth puis session.' }
    $from = (Get-Date).AddDays(-$Days).ToString('yyyy-MM-dd')
    foreach ($s in @(Get-Content $Store -Raw | ConvertFrom-Json)) {
      foreach ($uid in $s.accounts) {
        $det = try { Call GET "/accounts/$uid/details" } catch { $null }
        $label = if ($det) { "$($det.name) $($det.account_id.iban)" } else { $uid }
        "`n=== $($s.bank) | $label ==="
        try {
          (Call GET "/accounts/$uid/balances").balances | Select-Object -First 1 |
            ForEach-Object { "Solde : {0} {1} ({2})" -f $_.balance_amount.amount, $_.balance_amount.currency, $_.balance_type }
        } catch { "Solde indisponible : $_" }
        $txs = @(); $ck = $null
        do {
          $q = "/accounts/$uid/transactions?date_from=$from" + $(if ($ck) { "&continuation_key=$([uri]::EscapeDataString($ck))" })
          $r = Call GET $q; $txs += $r.transactions; $ck = $r.continuation_key
        } while ($ck)
        "{0} transaction(s) depuis le {1}" -f $txs.Count, $from
        $txs | Select-Object -First 15 | ForEach-Object {
          $sign = if ($_.credit_debit_indicator -eq 'DBIT') { '-' } else { '+' }
          $who  = if ($_.creditor.name) { $_.creditor.name } elseif ($_.debtor.name) { $_.debtor.name } else { '' }
          "  {0}  {1}{2,10} {3}  {4} {5}" -f $_.booking_date, $sign, $_.transaction_amount.amount, $_.transaction_amount.currency, $who, (($_.remittance_information) -join ' ')
        }
      }
    }
  }
}
