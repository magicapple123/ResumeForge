# SPDX-License-Identifier: Apache-2.0
<#
Tests for scripts\Create-DesktopShortcut.ps1, the desktop-shortcut step of the
portable release chain (start.cmd calls it with -IfMissing).

Two properties are invisible on a single-language machine, so both are pinned
here:

  - the shortcut file name follows the Windows UI language: a Chinese system
    gets 简历通.lnk, everything else gets ResumeForge.lnk;
  - -Remove and -IfMissing consider BOTH names, so changing the Windows display
    language cannot leave an orphan shortcut behind.

The script functions are loaded from the AST instead of running the script:
executing it would create (or remove) a shortcut on the real Desktop.

Run: pwsh -File scripts\tests\Test-DesktopShortcut.ps1
#>

[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$ProjectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$ShortcutScript = Join-Path $ProjectRoot "scripts\Create-DesktopShortcut.ps1"
$ChineseShortcutName = "简历通.lnk"
$EnglishShortcutName = "ResumeForge.lnk"
$TemporaryRoot = Join-Path ([IO.Path]::GetTempPath()) ("resumeforge-shortcut-test-" + [Guid]::NewGuid().ToString("N"))

function Assert-ShortcutTest {
    param(
        [bool]$Condition,
        [string]$Message
    )

    if (-not $Condition) {
        throw $Message
    }
}

function Send-TestDirectoryToRecycleBin {
    param([string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) {
        return
    }
    try {
        Add-Type -AssemblyName Microsoft.VisualBasic
        [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory(
            $Path,
            [Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs,
            [Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin
        )
    }
    catch {
        Write-Warning "Could not move shortcut test data to the recycle bin; leaving it in place: $($_.Exception.Message)"
    }
}

function New-ShortcutDirectory {
    param([string]$Name)

    $path = Join-Path $TemporaryRoot $Name
    New-Item -ItemType Directory -Force -Path $path | Out-Null
    return $path
}

function New-ShortcutFile {
    param(
        [string]$Directory,
        [string]$FileName
    )

    Set-Content -LiteralPath (Join-Path $Directory $FileName) -Value "stub" -Encoding ascii
}

try {
    Assert-ShortcutTest -Condition (Test-Path -LiteralPath $ShortcutScript) -Message "Create-DesktopShortcut.ps1 is missing: $ShortcutScript"

    # --- byte-level invariant: the file keeps its UTF-8 BOM ---
    #
    # Windows PowerShell 5.1 (what start.cmd runs) decodes a BOM-less file with
    # the ANSI code page; the Chinese shortcut name would become mojibake or a
    # syntax error. No pwsh syntax check can see this, so assert the bytes.
    $scriptBytes = [IO.File]::ReadAllBytes($ShortcutScript)
    $hasBom = $scriptBytes.Length -ge 3 -and $scriptBytes[0] -eq 0xEF -and $scriptBytes[1] -eq 0xBB -and $scriptBytes[2] -eq 0xBF
    Assert-ShortcutTest -Condition $hasBom -Message "Create-DesktopShortcut.ps1 must keep its UTF-8 BOM: PowerShell 5.1 decodes a BOM-less file with the ANSI code page and the Chinese shortcut name breaks."

    # --- load the functions without running the script body ---
    $tokens = $null
    $parseErrors = $null
    $scriptAst = [System.Management.Automation.Language.Parser]::ParseFile(
        $ShortcutScript,
        [ref]$tokens,
        [ref]$parseErrors
    )
    Assert-ShortcutTest -Condition ($parseErrors.Count -eq 0) -Message "Create-DesktopShortcut.ps1 has PowerShell syntax errors."
    $functionDefinitions = $scriptAst.FindAll(
        {
            param($node)
            return $node -is [System.Management.Automation.Language.FunctionDefinitionAst]
        },
        $true
    )
    foreach ($functionDefinition in $functionDefinitions) {
        Invoke-Expression $functionDefinition.Extent.Text
    }
    foreach ($requiredFunction in @("Resolve-ShortcutFileName", "Get-DesktopShortcutFileNames", "Test-DesktopShortcutExists", "Remove-DesktopShortcut")) {
        Assert-ShortcutTest -Condition ($null -ne (Get-Command $requiredFunction -ErrorAction SilentlyContinue)) -Message "Create-DesktopShortcut.ps1 is missing the function $requiredFunction."
    }

    # --- the name follows the system UI language ---
    foreach ($chineseCulture in @("zh", "zh-CN", "zh-Hans-CN", "zh-TW")) {
        $actualName = Resolve-ShortcutFileName -UICultureName $chineseCulture
        Assert-ShortcutTest -Condition ($actualName -eq $ChineseShortcutName) -Message "UI culture '$chineseCulture' must use the Chinese shortcut name; got '$actualName'."
    }
    foreach ($otherCulture in @("en-US", "en-GB", "de-DE", "ja-JP", "")) {
        $actualName = Resolve-ShortcutFileName -UICultureName $otherCulture
        Assert-ShortcutTest -Condition ($actualName -eq $EnglishShortcutName) -Message "UI culture '$otherCulture' must use the English shortcut name; got '$actualName'."
    }

    # The resolver must be fed the live UI culture; a correct function with a
    # hard-coded caller would still ship only one language's name.
    $scriptContent = [System.Text.Encoding]::UTF8.GetString($scriptBytes)
    Assert-ShortcutTest -Condition ($scriptContent -match 'Resolve-ShortcutFileName\s+-UICultureName\s+[^\r\n]*CurrentUICulture\.Name') -Message "Create-DesktopShortcut.ps1 must resolve the shortcut name from CultureInfo.CurrentUICulture.Name."
    Assert-ShortcutTest -Condition ($scriptContent -match 'Remove-DesktopShortcut\s+-DesktopDirectory') -Message "The -Remove branch must delete through Remove-DesktopShortcut so both language names are tried."
    Assert-ShortcutTest -Condition ($scriptContent -match 'Test-DesktopShortcutExists\s+-DesktopDirectory') -Message "The -IfMissing branch must check both shortcut names."

    $allNames = @(Get-DesktopShortcutFileNames)
    Assert-ShortcutTest -Condition ($allNames.Count -eq 2 -and $allNames -contains $ChineseShortcutName -and $allNames -contains $EnglishShortcutName) -Message "Get-DesktopShortcutFileNames must return both names; got '$($allNames -join ', ')'."

    # --- -Remove tries both names ---
    $bothDirectory = New-ShortcutDirectory -Name "both"
    New-ShortcutFile -Directory $bothDirectory -FileName $ChineseShortcutName
    New-ShortcutFile -Directory $bothDirectory -FileName $EnglishShortcutName
    $removeOutput = (Remove-DesktopShortcut -DesktopDirectory $bothDirectory 6>&1 | ForEach-Object { "$_" }) -join "; "
    $chineseLeft = Test-Path -LiteralPath (Join-Path $bothDirectory $ChineseShortcutName)
    $englishLeft = Test-Path -LiteralPath (Join-Path $bothDirectory $EnglishShortcutName)
    Assert-ShortcutTest -Condition (-not $chineseLeft -and -not $englishLeft) -Message "-Remove must delete both the Chinese and the English shortcut, not only the current UI language's name."
    Assert-ShortcutTest -Condition ($removeOutput -match [regex]::Escape($ChineseShortcutName) -and $removeOutput -match [regex]::Escape($EnglishShortcutName)) -Message "The -Remove branch must report every shortcut it deletes; output was: $removeOutput"

    # Only the "other" language's name is present: the display language was
    # switched after the shortcut was created.
    $otherLanguageDirectory = New-ShortcutDirectory -Name "other-language"
    New-ShortcutFile -Directory $otherLanguageDirectory -FileName $EnglishShortcutName
    Remove-DesktopShortcut -DesktopDirectory $otherLanguageDirectory | Out-Null
    Assert-ShortcutTest -Condition (-not (Test-Path -LiteralPath (Join-Path $otherLanguageDirectory $EnglishShortcutName))) -Message "-Remove must delete the English shortcut even on a Chinese system."

    # Nothing to remove keeps the existing message instead of throwing.
    $emptyDirectory = New-ShortcutDirectory -Name "empty"
    $emptyOutput = (Remove-DesktopShortcut -DesktopDirectory $emptyDirectory 6>&1 | ForEach-Object { "$_" }) -join "; "
    Assert-ShortcutTest -Condition ($emptyOutput -match "No desktop shortcut found") -Message "Removing with no shortcut present must report that there is nothing to remove; output was: $emptyOutput"

    # --- -IfMissing considers both names ---
    Assert-ShortcutTest -Condition (-not (Test-DesktopShortcutExists -DesktopDirectory $emptyDirectory)) -Message "-IfMissing must treat an empty Desktop as missing the shortcut."
    New-ShortcutFile -Directory $emptyDirectory -FileName $ChineseShortcutName
    Assert-ShortcutTest -Condition (Test-DesktopShortcutExists -DesktopDirectory $emptyDirectory) -Message "-IfMissing must exit silently when the Chinese shortcut exists."
    Remove-Item -LiteralPath (Join-Path $emptyDirectory $ChineseShortcutName) -Force
    Assert-ShortcutTest -Condition (-not (Test-DesktopShortcutExists -DesktopDirectory $emptyDirectory)) -Message "-IfMissing must not keep reporting an existing shortcut after it was deleted."
    New-ShortcutFile -Directory $emptyDirectory -FileName $EnglishShortcutName
    Assert-ShortcutTest -Condition (Test-DesktopShortcutExists -DesktopDirectory $emptyDirectory) -Message "-IfMissing must exit silently when the English shortcut exists (created before a display-language switch)."

    # --- the uninstaller removes the same set of names ---
    #
    # Uninstall-ResumeForge.ps1 ships on its own in the portable zip, so it cannot
    # dot-source the launcher and repeats the two names instead. The repetition is
    # only safe while both sides agree: compare the .lnk literals each file mentions.
    # A renamed language branch added on one side alone turns this red instead of
    # silently leaving an orphan shortcut behind.
    $uninstallScript = Join-Path $ProjectRoot "scripts\Uninstall-ResumeForge.ps1"
    Assert-ShortcutTest -Condition (Test-Path -LiteralPath $uninstallScript) -Message "Uninstall-ResumeForge.ps1 is missing: $uninstallScript"

    $uninstallBytes = [IO.File]::ReadAllBytes($uninstallScript)
    $uninstallHasBom = $uninstallBytes.Length -ge 3 -and $uninstallBytes[0] -eq 0xEF -and $uninstallBytes[1] -eq 0xBB -and $uninstallBytes[2] -eq 0xBF
    Assert-ShortcutTest -Condition $uninstallHasBom -Message "Uninstall-ResumeForge.ps1 must keep its UTF-8 BOM: it contains the Chinese shortcut name, which PowerShell 5.1 would decode with the ANSI code page."

    $uninstallContent = [System.Text.Encoding]::UTF8.GetString($uninstallBytes)
    $uninstallNames = @(
        [regex]::Matches($uninstallContent, '"([^"\r\n]+\.lnk)"') |
            ForEach-Object { $_.Groups[1].Value } |
            Sort-Object -Unique
    )
    $expectedShortcutNames = @($allNames | Sort-Object -Unique)
    $nameDifference = @(Compare-Object -ReferenceObject $expectedShortcutNames -DifferenceObject $uninstallNames)
    Assert-ShortcutTest -Condition ($uninstallNames.Count -eq $expectedShortcutNames.Count -and $nameDifference.Count -eq 0) -Message "Uninstall-ResumeForge.ps1 must remove exactly the shortcut names Create-DesktopShortcut.ps1 can create; launcher creates '$($expectedShortcutNames -join ', ')' but the uninstaller mentions '$($uninstallNames -join ', ')'."

    Write-Host "Desktop shortcut tests passed."
}
finally {
    Send-TestDirectoryToRecycleBin -Path $TemporaryRoot
}
