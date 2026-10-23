$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")
$docker = (Get-Command docker -ErrorAction SilentlyContinue).Source
if (-not $docker) {
    $docker = Join-Path $env:LOCALAPPDATA "Programs\DockerDesktop\resources\bin\docker.exe"
    if (-not (Test-Path $docker)) {
        $docker = Join-Path $env:ProgramFiles "Docker\Docker\resources\bin\docker.exe"
    }
}
if (-not (Test-Path $docker)) { throw "Docker was not found." }
$env:PATH = "$(Split-Path $docker);$env:PATH"
& $docker compose up --build -d
exit $LASTEXITCODE
