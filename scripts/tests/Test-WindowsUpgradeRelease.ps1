# SPDX-License-Identifier: Apache-2.0
$ErrorActionPreference = 'Stop'
$module = Join-Path $PSScriptRoot 'WindowsUpgradeRelease.psm1'
if (!(Test-Path -LiteralPath $module)) { throw 'The release must have a shared Windows upgrade contract' }
Import-Module $module -Force

function Assert-Rejected([scriptblock]$Operation, [string]$Message) {
    try { & $Operation }
    catch {
        if ($_.Exception.Message -like "*$Message*") { return }
        throw
    }
    throw "Expected rejection: $Message"
}

$published = @('v2.3.10', 'v2.2.3', 'v2.3.0', 'v2.3.2', 'v2.3.9-rc.1', 'rag-assets-v1')
$selected = @(Get-WindowsUpgradeBaselines -TargetTag 'v2.3.11' -PublishedTags $published)
if (($selected -join ',') -cne 'v2.3.0,v2.3.10') { throw "Incorrect upgrade matrix: $selected" }
$selected = @(Get-WindowsUpgradeBaselines -TargetTag 'v2.3.1' -PublishedTags $published)
if (($selected -join ',') -cne 'v2.3.0') { throw "Duplicate or non-older baseline: $selected" }
if ((Get-WindowsUpgradeBaselines -TargetTag 'v2.3.0' -PublishedTags $published -Rehearsal) -cne 'v2.3.0') {
    throw 'A rehearsal of Latest must start from the official v2.3.0 installation'
}
Assert-Rejected { Get-WindowsUpgradeBaselines -TargetTag 'v2.4.0' -PublishedTags @('v2.3.1') } 'Missing published upgrade baseline v2.3.0'

# The "public" mode rechecks whatever the public Latest currently is, and that
# Latest may still be the first release that supports in-app upgrade. There is
# then no older upgradeable baseline, and demanding one turned the plan job red
# (run 44997249814: "Upgrade target v2.3.0 must be newer than v2.3.0"). An empty
# baseline set is the correct answer, and the workflow skips the upgrade job.
# Get-WindowsUpgradeBaselines takes only TargetTag/PublishedTags/Rehearsal and
# pins v2.3.0 itself. Do not pass -FirstSupportedTag here: it is a simple
# (non-advanced) function, so an unknown named argument lands in $args and is
# silently ignored instead of throwing - the case would look like it controls
# the pin while actually being a no-op.
$selected = @(Get-WindowsUpgradeBaselines -TargetTag 'v2.3.0' -PublishedTags @('v2.2.3', 'v2.3.0'))
if ($selected.Count -ne 0) { throw "Latest must have no earlier upgradeable baseline: $selected" }
# A target older than the first supported release is still a caller mistake: the
# baseline would be newer than the build under test.
Assert-Rejected { Get-WindowsUpgradeBaselines -TargetTag 'v2.2.3' -PublishedTags @('v2.2.3', 'v2.3.0') } 'must be newer than v2.3.0'
# The ordinary path is untouched: newer target keeps upgrading from the first
# supported release.
$selected = @(Get-WindowsUpgradeBaselines -TargetTag 'v2.3.1' -PublishedTags @('v2.2.3', 'v2.3.0'))
if (($selected -join ',') -cne 'v2.3.0') { throw "Newer target must upgrade from v2.3.0: $selected" }
# Regression guard for rehearsal: it always starts from FirstSupportedTag, even
# when the target is newer (the already-verified path must not change).
if ((Get-WindowsUpgradeBaselines -TargetTag 'v2.3.1' -PublishedTags @('v2.2.3', 'v2.3.0', 'v2.3.1') -Rehearsal) -cne 'v2.3.0') {
    throw 'A rehearsal must start from the official first supported baseline'
}

$repo = 'example/ResumeForge'
$tag = 'v2.3.11'
$name = 'ResumeForge-Setup-2.3.11.exe'
$fixture = [pscustomobject]@{
    tag_name = $tag
    draft = $false
    prerelease = $false
    assets = @(
        [pscustomobject]@{ name = $name; state = 'uploaded'; size = 20; browser_download_url = "https://github.com/$repo/releases/download/$tag/$name" }
        [pscustomobject]@{ name = "$name.sha256"; state = 'uploaded'; size = 94; browser_download_url = "https://github.com/$repo/releases/download/$tag/$name.sha256" }
    )
}
Assert-WindowsUpgradeReleaseReady -Release $fixture -Repository $repo -TargetTag $tag
Assert-Rejected { Assert-WindowsUpgradeReleaseReady -Release $fixture -Repository $repo -TargetTag 'v2.3.12' } 'Latest is v2.3.11'
$fixture.assets[1].state = 'starter'
Assert-Rejected { Assert-WindowsUpgradeReleaseReady -Release $fixture -Repository $repo -TargetTag $tag } 'Missing or incomplete'
$fixture.assets = $fixture.assets[0]
Assert-Rejected { Assert-WindowsUpgradeReleaseReady -Release $fixture -Repository $repo -TargetTag $tag } "$name.sha256"
$fixture.assets[0].browser_download_url = "https://github.com/$repo/releases/download/v2.3.0/$name"
Assert-Rejected { Assert-WindowsUpgradeReleaseReady -Release $fixture -Repository $repo -TargetTag $tag } 'Unexpected public download URL'

Write-Output 'PASS: official upgrade sources, exact Latest and complete Windows release assets'
