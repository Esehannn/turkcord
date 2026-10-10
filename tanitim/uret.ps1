# Tanıtım görsellerini kaynak/index.html'den PNG olarak üretir. Önce `npm install` gerekir (Inter yazı tipi oradan gelir).
$chrome = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
if (-not (Test-Path $chrome)) { $chrome = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe' }
$page = 'file:///' + ((Join-Path $PSScriptRoot 'kaynak\index.html') -replace '\\', '/')

$shots = @(
  @{ s = '1'; file = 'tanitim-1-sohbet.png'; size = '1920,1080' },
  @{ s = '2'; file = 'tanitim-2-ses.png'; size = '1920,1080' },
  @{ s = '3'; file = 'tanitim-3-gorunum.png'; size = '1920,1080' },
  @{ s = 'banner'; file = 'banner.png'; size = '1500,500' },
  @{ s = 'logo'; file = 'logo.png'; size = '1024,1024' },
  @{ s = 'logo-beyaz'; file = 'logo-beyaz.png'; size = '1024,1024' }
)
foreach ($shot in $shots) {
  $out = Join-Path $PSScriptRoot $shot.file
  $args = @('--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
    '--default-background-color=00000000', '--virtual-time-budget=3000',
    "--window-size=$($shot.size)", "--screenshot=$out", "$page`?s=$($shot.s)")
  Start-Process -FilePath $chrome -ArgumentList $args -Wait -NoNewWindow
  Write-Output "$($shot.file) hazır"
}
