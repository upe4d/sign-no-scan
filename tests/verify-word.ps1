param([Parameter(Mandatory=$true)][string]$QaPath)
$ErrorActionPreference = 'Stop'
$resolvedQa = (Resolve-Path -LiteralPath $QaPath).Path
$wordApp = New-Object -ComObject Word.Application
$wordApp.Visible = $false
$wordApp.DisplayAlerts = 0
$wordApp.AutomationSecurity = 3
$sourceText = $null
$sourcePages = 0
function Open-TestDocument([string]$Path) {
    return $wordApp.Documents.Open($Path, $false, $true, $false)
}
try {
    foreach ($name in @('fixture','signed')) {
        $document = $null
        try {
            Write-Output "Открытие Word: $name.docx"
            $document = Open-TestDocument (Join-Path $resolvedQa ($name + '.docx'))
            $text = $document.Content.Text
            $pageCount = $document.ComputeStatistics(2)
            if ($name -eq 'fixture') { $sourceText = $text; $sourcePages = $pageCount }
            else {
                if ($text -cne $sourceText) { throw 'Word обнаружил изменение исходного текста.' }
                if ($pageCount -ne $sourcePages) { throw 'Word обнаружил изменение числа страниц.' }
                if ($document.Shapes.Count -ne 1) { throw 'Word не обнаружил добавленную плавающую подпись.' }
                Write-Output "Word: текст сохранён, страниц $pageCount, подпись обнаружена."
            }
            $document.ExportAsFixedFormat((Join-Path $resolvedQa ($name + '-word.pdf')),17)
        } finally {
            if ($null -ne $document) { $document.Close(0); [void][Runtime.InteropServices.Marshal]::ReleaseComObject($document) }
        }
    }
    $imageDocument = $null
    try {
        $imageDocument = Open-TestDocument (Join-Path $resolvedQa 'pdf-image.docx')
        $imagePages = $imageDocument.ComputeStatistics(2)
        if ($imagePages -ne 4 -or $imageDocument.Shapes.Count -ne 4) { throw "PDF → Word: ожидалось 4 страницы и 4 картинки, получено $imagePages страниц и $($imageDocument.Shapes.Count) картинок." }
        $imageDocument.ExportAsFixedFormat((Join-Path $resolvedQa 'pdf-image-word.pdf'),17)
        Write-Output 'PDF → Word: 4 страницы и 4 картинки открыты, экспорт в PDF выполнен.'
    } finally {
        if ($null -ne $imageDocument) { $imageDocument.Close(0); [void][Runtime.InteropServices.Marshal]::ReleaseComObject($imageDocument) }
    }
} finally {
    $wordApp.Quit(0)
    [void][Runtime.InteropServices.Marshal]::ReleaseComObject($wordApp)
}
