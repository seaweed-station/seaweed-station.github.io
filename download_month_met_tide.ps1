param(
    [int]$Year = 2026,
    [int]$Month = 2,
    [string]$SourceDataRoot = "",
    [string]$MirrorDataRoot = ""
)

$ErrorActionPreference = "Stop"

$openMeteoHelpers = Join-Path $PSScriptRoot "open_meteo_helpers.ps1"
if (!(Test-Path $openMeteoHelpers)) {
    throw "Missing helper script: $openMeteoHelpers"
}
. $openMeteoHelpers

if ($Month -lt 1 -or $Month -gt 12) {
    throw "Month must be 1..12"
}

$scriptRoot = $PSScriptRoot
if ($SourceDataRoot -eq "") {
    $SourceDataRoot = Join-Path $scriptRoot "data"
}
if (!(Test-Path $SourceDataRoot)) {
    New-Item -ItemType Directory -Path $SourceDataRoot -Force | Out-Null
}

$configFile = Join-Path $scriptRoot "config.json"
$configChannels = @()
if (Test-Path $configFile) {
    try {
        $cfg = [System.IO.File]::ReadAllText($configFile, [System.Text.Encoding]::UTF8) | ConvertFrom-Json
        if ($cfg.channels) {
            foreach ($ch in $cfg.channels) {
                if ($ch.dataFolder) {
                    $configChannels += [ordered]@{
                        id = if ($ch.id) { [string]$ch.id } else { "" }
                        folder = [string]$ch.dataFolder
                    }
                }
            }
        }
    }
    catch {
        Write-Host "[warn] Could not parse config.json, continuing with discovered folders." -ForegroundColor Yellow
    }
}

# Add any existing data_ folders so all systems are covered (including legacy folders)
$discoveredFolders = @()
if (Test-Path $SourceDataRoot) {
    $discoveredFolders = Get-ChildItem -Path $SourceDataRoot -Directory | Where-Object { $_.Name -like "data_*" } | Select-Object -ExpandProperty Name
}

$systems = @{}
foreach ($ch in $configChannels) {
    if (-not $systems.ContainsKey($ch.folder)) {
        $systems[$ch.folder] = [ordered]@{ id = $ch.id; folder = $ch.folder }
    }
}
foreach ($folder in $discoveredFolders) {
    if (-not $systems.ContainsKey($folder)) {
        $guessId = ""
        if ($folder -match "3262071") { $guessId = "perth" }
        elseif ($folder -match "shangani") { $guessId = "shangani" }
        elseif ($folder -match "funzi") { $guessId = "funzi" }
        $systems[$folder] = [ordered]@{ id = $guessId; folder = $folder }
    }
}

if ($systems.Count -eq 0) {
    throw "No system folders found under $SourceDataRoot"
}

$locMap = @{}
$mmtCfgFile = Join-Path $PSScriptRoot "config.json"
if (Test-Path $mmtCfgFile) {
    try {
        $mmtJson = [System.IO.File]::ReadAllText($mmtCfgFile, [System.Text.Encoding]::UTF8) | ConvertFrom-Json
        if ($mmtJson.stations) {
            foreach ($s in $mmtJson.stations) {
                if ($null -ne $s.lat -and $null -ne $s.lon -and $s.weatherName) {
                    $locMap[$s.id] = [ordered]@{
                        lat = $s.lat; lon = $s.lon
                        tideStation = if ($s.tideStation) { $s.tideStation } else { "kenya" }
                        label = $s.weatherName
                    }
                }
            }
        }
    } catch {}
}
if ($locMap.Count -eq 0) {
    # Fallback – keep in sync with config.json
    $locMap = @{
        perth = [ordered]@{ lat = -31.87; lon = 115.90; tideStation = "perth"; label = "Perth / Noranda" }
        shangani = [ordered]@{ lat = -4.55; lon = 39.50; tideStation = "kenya"; label = "Shangani Aramani, Kenya" }
        funzi = [ordered]@{ lat = -4.581429; lon = 39.437527; tideStation = "kenya"; label = "Funzi Island, Kenya" }
    }
}

function Resolve-Location($sys) {
    if ($sys.id -and $locMap.ContainsKey($sys.id)) {
        return $locMap[$sys.id]
    }

    $f = $sys.folder.ToLowerInvariant()
    if ($f -match "3262071") { return $locMap["perth"] }
    if ($f -match "shangani") { return $locMap["shangani"] }
    if ($f -match "funzi") { return $locMap["funzi"] }

    return $locMap["perth"]
}

# Tide model constants (matching pages/tides.js)
$DEG = [Math]::PI / 180.0
$J2000 = [DateTimeOffset]::Parse("2000-01-01T12:00:00Z")
$SPEEDS = @{ M2=28.9841042; S2=30.0000000; N2=28.4397295; K1=15.0410686; O1=13.9430356; P1=14.9589314; K2=30.0821373 }
$V0 = @{ M2=124.30; S2=0.00; N2=349.34; K1=190.47; O1=293.83; P1=169.53; K2=200.93 }
$NODAL_F = @{ M2=0.965; S2=1.0; N2=0.965; K1=1.115; O1=1.187; P1=1.0; K2=1.23 }
$NODAL_U = @{ M2=0.66; S2=0.0; N2=0.66; K1=2.71; O1=-3.31; P1=0.0; K2=5.42 }
$TIDE_LOC = @{
    perth = [ordered]@{
        name = "Fremantle, WA"
        z0 = 0.80
        constituents = @(
            @{ id='M2'; amp=0.158; phase=211 }, @{ id='S2'; amp=0.059; phase=240 }, @{ id='N2'; amp=0.033; phase=199 },
            @{ id='K1'; amp=0.169; phase=108 }, @{ id='O1'; amp=0.102; phase=91  }, @{ id='P1'; amp=0.055; phase=108 }, @{ id='K2'; amp=0.016; phase=240 }
        )
    }
    kenya = [ordered]@{
        name = "Mombasa, Kenya"
        z0 = 2.00
        constituents = @(
            @{ id='M2'; amp=1.14; phase=28 }, @{ id='S2'; amp=0.58; phase=59 }, @{ id='N2'; amp=0.24; phase=8 },
            @{ id='K1'; amp=0.23; phase=206 }, @{ id='O1'; amp=0.12; phase=176 }, @{ id='P1'; amp=0.08; phase=206 }, @{ id='K2'; amp=0.16; phase=59 }
        )
    }
}

function Get-TideHeight([DateTimeOffset]$dt, [string]$station) {
    $loc = $TIDE_LOC[$station]
    $hours = ($dt - $J2000).TotalHours
    $h = [double]$loc.z0
    foreach ($c in $loc.constituents) {
        $cid = [string]$c.id
        $arg = $SPEEDS[$cid] * $hours + $V0[$cid] + $NODAL_U[$cid] - [double]$c.phase
        $h += $NODAL_F[$cid] * [double]$c.amp * [Math]::Cos($arg * $DEG)
    }
    return [Math]::Round($h, 4)
}

function Build-TideCache([string]$station, [datetime]$startLocal, [datetime]$endLocal, [string]$timezoneId) {
    $points = New-Object System.Collections.Generic.List[object]

    $cur = $startLocal
    while ($cur -le $endLocal) {
        $dto = [DateTimeOffset]::new($cur)
        $points.Add([ordered]@{
            time = $cur.ToString("yyyy-MM-ddTHH:mm")
            height_m = (Get-TideHeight -dt $dto.ToUniversalTime() -station $station)
        })
        $cur = $cur.AddHours(1)
    }

    $extremes = New-Object System.Collections.Generic.List[object]
    for ($i=1; $i -lt $points.Count-1; $i++) {
        $p = [double]$points[$i-1].height_m
        $c = [double]$points[$i].height_m
        $n = [double]$points[$i+1].height_m
        if ($c -gt $p -and $c -gt $n) {
            $extremes.Add([ordered]@{ time = $points[$i].time; type = "high"; height_m = $points[$i].height_m })
        }
        elseif ($c -lt $p -and $c -lt $n) {
            $extremes.Add([ordered]@{ time = $points[$i].time; type = "low"; height_m = $points[$i].height_m })
        }
    }

    return [ordered]@{
        station = $station
        station_name = $TIDE_LOC[$station].name
        timezone = $timezoneId
        start_date = $startLocal.ToString("yyyy-MM-dd")
        end_date = $endLocal.ToString("yyyy-MM-dd")
        hourly = $points
        extremes = $extremes
    }
}

$startDate = Get-Date -Year $Year -Month $Month -Day 1 -Hour 0 -Minute 0 -Second 0
$endDate = $startDate.AddMonths(1).AddDays(-1)
$startStr = $startDate.ToString("yyyy-MM-dd")
$endStr = $endDate.ToString("yyyy-MM-dd")
$monthTag = "{0}-{1:00}" -f $Year, $Month

Write-Host ""
Write-Host "=== $monthTag Met + Tide Backfill ===" -ForegroundColor Cyan
Write-Host "Source data root : $SourceDataRoot"
if ($MirrorDataRoot -ne "") { Write-Host "Mirror data root : $MirrorDataRoot" }
Write-Host "Range            : $startStr to $endStr"
Write-Host "Systems          : $($systems.Count)"
Write-Host ""

foreach ($sys in $systems.Values) {
    $loc = Resolve-Location $sys
    $folder = Join-Path $SourceDataRoot $sys.folder
    if (!(Test-Path $folder)) { New-Item -ItemType Directory -Path $folder -Force | Out-Null }

    $timezoneId = if ($loc.tideStation -eq "kenya") { "Africa/Nairobi" } else { "Australia/Perth" }

    Write-Host "[met] $($sys.folder) -> $($loc.label)"
    $metObj = Get-OpenMeteoWeatherData -lat $loc.lat -lon $loc.lon -startDate $startStr -endDate $endStr
    $metJson = ($metObj | ConvertTo-Json -Depth 8 -Compress)

    if ($metJson -notmatch '"hourly"\s*:') {
        throw "Open-Meteo returned no hourly data for $($sys.folder)"
    }

    $metHeader  = "// Auto-generated monthly weather cache by download_month_met_tide.ps1`r`n"
    $metHeader += "// Downloaded: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')`r`n"
    $metHeader += "// Range: $startStr to $endStr`r`n"
    $metContent = $metHeader + "window.WEATHER_CACHE = " + $metJson + ";`r`n"

    # Primary weather_data.js is owned by download_data_supabase.ps1 (daily CI).
    # This backfill script only writes the monthly archive.
    $metOutMonthly = Join-Path $folder "weather_data_$monthTag.js"
    [System.IO.File]::WriteAllText("$metOutMonthly.tmp", $metContent, [System.Text.Encoding]::UTF8)
    Move-Item -Path "$metOutMonthly.tmp" -Destination $metOutMonthly -Force

    # Tide cache (computed from harmonic model)
    Write-Host "[tide] $($sys.folder) -> $($loc.tideStation)"
    $tideObj = Build-TideCache -station $loc.tideStation -startLocal $startDate -endLocal ($endDate.AddHours(23)) -timezoneId $timezoneId
    $tideJson = $tideObj | ConvertTo-Json -Depth 8 -Compress

    $tideHeader  = "// Auto-generated monthly tide cache by download_month_met_tide.ps1`r`n"
    $tideHeader += "// Downloaded: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')`r`n"
    $tideHeader += "// Range: $startStr to $endStr`r`n"
    $tideContent = $tideHeader + "window.TIDE_CACHE = " + $tideJson + ";`r`n"

    $tideOutPrimary = Join-Path $folder "tide_data.js"
    $tideOutMonthly = Join-Path $folder "tide_data_$monthTag.js"
    [System.IO.File]::WriteAllText("$tideOutPrimary.tmp", $tideContent, [System.Text.Encoding]::UTF8)
    Move-Item -Path "$tideOutPrimary.tmp" -Destination $tideOutPrimary -Force
    [System.IO.File]::WriteAllText("$tideOutMonthly.tmp", $tideContent, [System.Text.Encoding]::UTF8)
    Move-Item -Path "$tideOutMonthly.tmp" -Destination $tideOutMonthly -Force

    # Optional mirror path (for local embedded dashboard)
    if ($MirrorDataRoot -ne "") {
        $mirrorFolder = Join-Path $MirrorDataRoot $sys.folder
        if (!(Test-Path $mirrorFolder)) { New-Item -ItemType Directory -Path $mirrorFolder -Force | Out-Null }
        Copy-Item -Path $metOutMonthly -Destination (Join-Path $mirrorFolder "weather_data_$monthTag.js") -Force
        Copy-Item -Path $tideOutPrimary -Destination (Join-Path $mirrorFolder "tide_data.js") -Force
        Copy-Item -Path $tideOutMonthly -Destination (Join-Path $mirrorFolder "tide_data_$monthTag.js") -Force
    }
}

Write-Host ""
Write-Host "Completed monthly met+tide cache backfill for $monthTag." -ForegroundColor Green
