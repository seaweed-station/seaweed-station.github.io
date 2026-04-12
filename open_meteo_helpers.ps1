function ConvertTo-IsoDateOrEmpty([string]$DateValue, [string]$SettingName = "date") {
    if ([string]::IsNullOrWhiteSpace($DateValue)) {
        return ""
    }

    try {
        return ([datetime]::Parse($DateValue)).ToString("yyyy-MM-dd")
    }
    catch {
        throw "$SettingName must be a valid yyyy-MM-dd value"
    }
}

function Invoke-OpenMeteoWeather([double]$lat, [double]$lon, [string]$startDate, [string]$endDate, [string]$apiBase) {
    $url = "${apiBase}?latitude=$lat&longitude=$lon" +
        "&start_date=$startDate&end_date=$endDate" +
        "&hourly=temperature_2m,relative_humidity_2m,precipitation,cloud_cover,weather_code,uv_index" +
        "&daily=sunrise,sunset" +
        "&timezone=auto"
    $resp = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 30
    return ($resp.Content | ConvertFrom-Json)
}

function Merge-OpenMeteoWeather($a, $b) {
    if ($null -eq $a) { return $b }
    if ($null -eq $b) { return $a }

    $rowMap = @{}
    $hourlyFields = @("temperature_2m", "relative_humidity_2m", "precipitation", "cloud_cover", "weather_code", "uv_index")

    foreach ($src in @($a, $b)) {
        if ($src.hourly -and $src.hourly.time) {
            for ($i = 0; $i -lt $src.hourly.time.Count; $i++) {
                $t = [string]$src.hourly.time[$i]
                if (-not $rowMap.ContainsKey($t)) {
                    $rowMap[$t] = @{}
                }
                foreach ($field in $hourlyFields) {
                    $vals = $src.hourly.$field
                    if ($vals -and $i -lt $vals.Count) {
                        $rowMap[$t][$field] = $vals[$i]
                    }
                }
            }
        }
    }

    $sortedTimes = @($rowMap.Keys | Sort-Object)
    $mergedHourly = @{ time = @($sortedTimes) }
    foreach ($field in $hourlyFields) {
        $arr = New-Object System.Collections.Generic.List[object]
        foreach ($t in $sortedTimes) {
            if ($rowMap[$t].ContainsKey($field)) { $arr.Add($rowMap[$t][$field]) }
            else { $arr.Add($null) }
        }
        $mergedHourly[$field] = $arr.ToArray()
    }

    $dailyMap = @{}
    foreach ($src in @($a, $b)) {
        if ($src.daily -and $src.daily.time) {
            for ($i = 0; $i -lt $src.daily.time.Count; $i++) {
                $d = [string]$src.daily.time[$i]
                $dailyMap[$d] = @{
                    sunrise = if ($src.daily.sunrise -and $i -lt $src.daily.sunrise.Count) { $src.daily.sunrise[$i] } else { $null }
                    sunset  = if ($src.daily.sunset  -and $i -lt $src.daily.sunset.Count)  { $src.daily.sunset[$i] }  else { $null }
                }
            }
        }
    }

    $sortedDays = @($dailyMap.Keys | Sort-Object)
    $dailySunrise = New-Object System.Collections.Generic.List[object]
    $dailySunset = New-Object System.Collections.Generic.List[object]
    foreach ($d in $sortedDays) {
        $dailySunrise.Add($dailyMap[$d].sunrise)
        $dailySunset.Add($dailyMap[$d].sunset)
    }

    return [ordered]@{
        latitude = if ($b.latitude) { $b.latitude } else { $a.latitude }
        longitude = if ($b.longitude) { $b.longitude } else { $a.longitude }
        generationtime_ms = if ($b.generationtime_ms) { $b.generationtime_ms } else { $a.generationtime_ms }
        utc_offset_seconds = if ($b.utc_offset_seconds) { $b.utc_offset_seconds } else { $a.utc_offset_seconds }
        timezone = if ($b.timezone) { $b.timezone } else { $a.timezone }
        timezone_abbreviation = if ($b.timezone_abbreviation) { $b.timezone_abbreviation } else { $a.timezone_abbreviation }
        elevation = if ($b.elevation) { $b.elevation } else { $a.elevation }
        hourly_units = if ($b.hourly_units) { $b.hourly_units } else { $a.hourly_units }
        hourly = $mergedHourly
        daily_units = if ($b.daily_units) { $b.daily_units } else { $a.daily_units }
        daily = @{ time = @($sortedDays); sunrise = $dailySunrise.ToArray(); sunset = $dailySunset.ToArray() }
    }
}

function Get-OpenMeteoWeatherData([double]$lat, [double]$lon, [string]$startDate, [string]$endDate) {
    $today = (Get-Date).ToString("yyyy-MM-dd")

    if ($endDate -lt $today) {
        return Invoke-OpenMeteoWeather -lat $lat -lon $lon -startDate $startDate -endDate $endDate -apiBase "https://archive-api.open-meteo.com/v1/archive"
    }

    if ($startDate -ge $today) {
        return Invoke-OpenMeteoWeather -lat $lat -lon $lon -startDate $startDate -endDate $endDate -apiBase "https://api.open-meteo.com/v1/forecast"
    }

    $yesterday = (Get-Date $today).AddDays(-1).ToString("yyyy-MM-dd")
    $history = Invoke-OpenMeteoWeather -lat $lat -lon $lon -startDate $startDate -endDate $yesterday -apiBase "https://archive-api.open-meteo.com/v1/archive"
    $forecast = Invoke-OpenMeteoWeather -lat $lat -lon $lon -startDate $today -endDate $endDate -apiBase "https://api.open-meteo.com/v1/forecast"
    return Merge-OpenMeteoWeather -a $history -b $forecast
}