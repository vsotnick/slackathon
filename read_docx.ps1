Add-Type -AssemblyName System.IO.Compression.FileSystem
try {
  $zip = [System.IO.Compression.ZipFile]::OpenRead("d:\vsot\slackathon\docs\slackathon_requirements.docx")
  $entry = $zip.GetEntry("word/document.xml")
  if ($entry) {
    $stream = $entry.Open()
    $reader = New-Object System.IO.StreamReader($stream)
    $xmlStr = $reader.ReadToEnd()
    $reader.Close()
    $stream.Close()
    $text = $xmlStr -replace '<w:p ', "`n<w:p " -replace '<[^>]+>', ''
    
    # Write UTF8 without BOM
    $utf8NoBom = New-Object System.Text.UTF8Encoding $false
    [System.IO.File]::WriteAllText("d:\vsot\slackathon\docs\reqs_clean.txt", $text, $utf8NoBom)
  }
} catch {
  Write-Error $_
} finally {
  if ($zip) { $zip.Dispose() }
}
