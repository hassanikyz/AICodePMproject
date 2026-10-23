# Container scripts

The scripts run Docker Compose from the repository root, regardless of the caller's working directory.

- Mac/Linux: `start.sh` and `stop.sh`.
- Windows PowerShell: `start.ps1` and `stop.ps1`.
- Windows Command Prompt: `start.bat` and `stop.bat`.

Start builds and launches the service in the background. Stop removes the running service but preserves the named SQLite data volume. Docker Engine or Docker Desktop with Compose is required.
