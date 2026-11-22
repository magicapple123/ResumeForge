# SPDX-License-Identifier: Apache-2.0
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'DesktopPackageUpgrade.psm1') -Force

function Assert-Rejected([scriptblock]$Operation, [string]$Message) {
    try { & $Operation }
    catch {
        if ($_.Exception.Message -like "*$Message*") { return }
        throw
    }
    throw "Expected rejection: $Message"
}

$published = @('v2.3.10', 'v2.2.3', 'v2.3.0', 'v2.3.2', 'v2.3.9-rc.1', 'rag-assets-v1')
$baselines = @(Get-DesktopUpgradeBaselines -TargetTag v2.3.11 -PublishedTags $published -FirstSupportedTag v2.2.3)
if (($baselines -join ',') -cne 'v2.2.3,v2.3.10') { throw "Incorrect upgrade matrix: $baselines" }
$baselines = @(Get-DesktopUpgradeBaselines -TargetTag v2.3.1 -PublishedTags $published -FirstSupportedTag v2.2.3)
if (($baselines -join ',') -cne 'v2.2.3,v2.3.0') { throw "Incorrect upgrade matrix: $baselines" }
if ((Get-DesktopUpgradeBaselines -TargetTag v2.3.0 -PublishedTags $published -FirstSupportedTag v2.2.3 -Rehearsal) -cne 'v2.2.3') {
    throw 'A rehearsal of Latest must start from the official first supported baseline'
}
Assert-Rejected { Get-DesktopUpgradeBaselines -TargetTag v2.3.11 -PublishedTags @('v2.3.10') -FirstSupportedTag v2.2.3 } 'Missing published upgrade baseline v2.2.3'
# `public` mode rechecks the current Latest; when that Latest *is* the first
# supported release there is no older upgradeable baseline, so the matrix is
# empty instead of an exception (the callers skip the upgrade job on []).
$baselines = @(Get-DesktopUpgradeBaselines -TargetTag v2.3.0 -PublishedTags $published -FirstSupportedTag v2.3.0)
if ($baselines.Count -ne 0) { throw "First supported release must have no earlier baseline: $baselines" }
Assert-Rejected { Get-DesktopUpgradeBaselines -TargetTag v2.2.3 -PublishedTags $published -FirstSupportedTag v2.3.0 } 'must be newer'

$expectedNames = @{
    'macos/x64' = 'ResumeForge-2.3.11-x64.dmg'
    'macos/arm64' = 'ResumeForge-2.3.11-arm64.dmg'
    'linux/x64' = 'ResumeForge-2.3.11-x86_64.AppImage'
    'linux/arm64' = 'ResumeForge-2.3.11-arm64.AppImage'
}
foreach ($target in $expectedNames.Keys) {
    $parts = $target.Split('/')
    $name = Get-DesktopPackageAssetNames $parts[0] $parts[1] '2.3.11'
    if ($name[0] -cne $expectedNames[$target] -or $name[1] -cne "$($expectedNames[$target]).sha256") {
        throw "Incorrect release asset for ${target}: $name"
    }
}
Assert-Rejected { Get-DesktopPackageAssetNames windows x64 2.3.11 } 'Unsupported desktop package target'
$runnerLabels = @{
    'macos/x64' = 'macos-15-intel'
    'macos/arm64' = 'macos-15'
    'linux/x64' = 'ubuntu-24.04'
    'linux/arm64' = 'ubuntu-24.04-arm'
}
foreach ($target in $runnerLabels.Keys) {
    $parts = $target.Split('/')
    if ((Get-DesktopPackageRunnerLabel $parts[0] $parts[1]) -cne $runnerLabels[$target]) {
        throw "Incorrect native package runner for ${target}"
    }
}

$repository = 'example/ResumeForge'
$tag = 'v2.3.11'
$assetNames = Get-DesktopPackageAssetNames macos arm64 '2.3.11'
$assets = @($assetNames | ForEach-Object {
    [pscustomobject]@{
        name = $_
        state = 'uploaded'
        size = 100
        browser_download_url = "https://github.com/$repository/releases/download/$tag/$_"
    }
})
$release = [pscustomobject]@{ tag_name = $tag; draft = $false; prerelease = $false; assets = $assets }
Assert-DesktopPackageReleaseReady $release $repository $tag macos arm64
Assert-Rejected { Assert-DesktopPackageReleaseReady $release $repository 'v2.3.12' macos arm64 } 'Expected stable'
$release.assets[1].state = 'starter'
Assert-Rejected { Assert-DesktopPackageReleaseReady $release $repository $tag macos arm64 } 'Missing or incomplete'
$release.assets = @($assets[0])
Assert-Rejected { Assert-DesktopPackageReleaseReady $release $repository $tag macos arm64 } "$($assetNames[1])"
$release.assets = @($assets)
$release.assets[0].browser_download_url = "https://github.com/$repository/releases/download/v2.3.0/$($assetNames[0])"
Assert-Rejected { Assert-DesktopPackageReleaseReady $release $repository $tag macos arm64 } 'Unexpected public download URL'

Write-Output 'PASS: native package upgrade matrix and public macOS/Linux asset contracts'
