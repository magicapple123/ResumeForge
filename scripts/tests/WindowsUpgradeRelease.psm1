# SPDX-License-Identifier: Apache-2.0
Set-StrictMode -Version Latest
Import-Module (Join-Path $PSScriptRoot 'DesktopPackageUpgrade.psm1') -ErrorAction Stop
$script:FirstSupportedTag = 'v2.3.0'

function Get-WindowsReleaseVersion([string]$Tag) {
    return ConvertTo-DesktopReleaseVersion $Tag
}

function Get-WindowsUpgradeBaselines([string]$TargetTag, [string[]]$PublishedTags, [switch]$Rehearsal) {
    return Get-DesktopUpgradeBaselines -TargetTag $TargetTag -PublishedTags $PublishedTags -FirstSupportedTag $script:FirstSupportedTag -Rehearsal:$Rehearsal
}

function Get-WindowsInstallerName([string]$Tag) {
    $version = Get-WindowsReleaseVersion $Tag
    return "ResumeForge-Setup-$version.exe"
}

function Assert-WindowsUpgradeReleaseReady($Release, [string]$Repository, [string]$TargetTag) {
    if ($Release.draft -or $Release.prerelease -or $Release.tag_name -cne $TargetTag) {
        throw "Public Latest is $($Release.tag_name). Expected stable $TargetTag."
    }
    $name = Get-WindowsInstallerName $TargetTag
    foreach ($file in @($name, "$name.sha256")) {
        $asset = @($Release.assets | Where-Object name -CEQ $file)
        if ($asset.Count -ne 1 -or $asset[0].state -ne 'uploaded' -or $asset[0].size -le 0) {
            throw "Missing or incomplete public asset: $file"
        }
        if ($asset[0].browser_download_url -cne "https://github.com/$Repository/releases/download/$TargetTag/$file") {
            throw "Unexpected public download URL for $file"
        }
    }
}

function Get-PublicWindowsLatestRelease([string]$Repository, [string]$TargetTag) {
    # The installed updater uses this anonymous endpoint. Authenticated draft
    # metadata from gh would not exercise the same publication boundary.
    for ($attempt = 1; $attempt -le 6; $attempt++) {
        try {
            $release = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repository/releases/latest" -UserAgent 'ResumeForge-Desktop-Updater' -TimeoutSec 20 -ErrorAction Stop
            Assert-WindowsUpgradeReleaseReady $release $Repository $TargetTag
            return $release
        }
        catch {
            if ($attempt -eq 6) { throw }
            Write-Warning "Public release check $attempt/6 failed: $($_.Exception.Message)"
            Start-Sleep -Seconds 10
        }
    }
}

function Assert-WindowsInstallerChecksum([string]$Path) {
    Assert-DesktopPackageChecksum $Path
}
