# SPDX-License-Identifier: Apache-2.0
Set-StrictMode -Version Latest

function ConvertTo-DesktopReleaseVersion([string]$Tag) {
    if ($Tag -cnotmatch '^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$') {
        throw "Expected a stable version tag (vMAJOR.MINOR.PATCH), got '$Tag'"
    }
    return [version]$Tag.Substring(1)
}

function Get-DesktopUpgradeBaselines(
    [string]$TargetTag,
    [string[]]$PublishedTags,
    [string]$FirstSupportedTag = 'v2.2.3',
    [switch]$Rehearsal
) {
    $target = ConvertTo-DesktopReleaseVersion $TargetTag
    $first = ConvertTo-DesktopReleaseVersion $FirstSupportedTag
    if ($FirstSupportedTag -cnotin $PublishedTags) {
        throw "Missing published upgrade baseline $FirstSupportedTag"
    }
    # A rehearsal builds its own newer candidate, so its target is always newer
    # than the first supported tag and the baseline is deliberately pinned to
    # that tag. Keep the early return: this path is the one that has actually
    # been verified end to end.
    if ($Rehearsal) { return $FirstSupportedTag }
    # Target older than the first upgradeable release means the caller mixed up
    # its inputs (the baseline would be newer than the build under test), so
    # this stays a hard failure.
    if ($target -lt $first) { throw "Upgrade target $TargetTag must be newer than $FirstSupportedTag" }
    # Target equal to the first upgradeable release ("public" rechecks whatever
    # the public Latest currently is, and Latest may still be that very
    # release): there is no older published release that supports in-app
    # upgrade, so the baseline set is genuinely empty. Returning nothing lets
    # the caller skip the upgrade job; throwing here would make the whole
    # "recheck public Latest" mode fail with no verification path left.
    if ($target -eq $first) { return @() }
    $previous = $PublishedTags |
        Where-Object { $_ -cmatch '^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$' } |
        ForEach-Object { ConvertTo-DesktopReleaseVersion $_ } |
        Where-Object { $_ -ge $first -and $_ -lt $target } |
        Sort-Object -Descending |
        Select-Object -First 1
    return @($FirstSupportedTag, "v$previous") | Select-Object -Unique
}

function Get-DesktopPackageAssetNames([string]$Platform, [string]$Architecture, [string]$Version) {
    $versionValue = ConvertTo-DesktopReleaseVersion "v$Version"
    switch ("$Platform/$Architecture") {
        'macos/x64' { $archName = 'x64'; $extension = 'dmg' }
        'macos/arm64' { $archName = 'arm64'; $extension = 'dmg' }
        'linux/x64' { $archName = 'x86_64'; $extension = 'AppImage' }
        'linux/arm64' { $archName = 'arm64'; $extension = 'AppImage' }
        default { throw "Unsupported desktop package target: $Platform/$Architecture" }
    }
    $package = "ResumeForge-$versionValue-$archName.$extension"
    return @($package, "$package.sha256")
}

function Get-DesktopPackageRunnerLabel([string]$Platform, [string]$Architecture) {
    switch ("$Platform/$Architecture") {
        'macos/x64' { return 'macos-15-intel' }
        'macos/arm64' { return 'macos-15' }
        'linux/x64' { return 'ubuntu-24.04' }
        'linux/arm64' { return 'ubuntu-24.04-arm' }
        default { throw "Unsupported desktop package runner: $Platform/$Architecture" }
    }
}

function Assert-DesktopPackageReleaseReady(
    $Release,
    [string]$Repository,
    [string]$TargetTag,
    [string]$Platform,
    [string]$Architecture
) {
    if ($Release.draft -or $Release.prerelease -or $Release.tag_name -cne $TargetTag) {
        throw "Public release is $($Release.tag_name). Expected stable $TargetTag."
    }
    $version = (ConvertTo-DesktopReleaseVersion $TargetTag).ToString()
    foreach ($file in Get-DesktopPackageAssetNames $Platform $Architecture $version) {
        $assets = @($Release.assets | Where-Object name -CEQ $file)
        if ($assets.Count -ne 1 -or $assets[0].state -ne 'uploaded' -or $assets[0].size -le 0) {
            throw "Missing or incomplete public asset: $file"
        }
        $expectedUrl = "https://github.com/$Repository/releases/download/$TargetTag/$file"
        if ($assets[0].browser_download_url -cne $expectedUrl) {
            throw "Unexpected public download URL for $file"
        }
    }
}

function Assert-DesktopPackageChecksum([string]$Path) {
    $package = Get-Item -LiteralPath $Path -ErrorAction Stop
    $sidecar = [IO.File]::ReadAllText("$($package.FullName).sha256").TrimEnd()
    $hash = (Get-FileHash -LiteralPath $package.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($sidecar -cne "$hash  $($package.Name)") { throw "SHA-256 mismatch: $($package.Name)" }
}

Export-ModuleMember -Function Assert-DesktopPackageChecksum, Assert-DesktopPackageReleaseReady, ConvertTo-DesktopReleaseVersion, Get-DesktopPackageAssetNames, Get-DesktopPackageRunnerLabel, Get-DesktopUpgradeBaselines
