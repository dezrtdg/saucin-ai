# Saucin AI txAdmin collector (Windows 11)

This read-only collector watches new `.log` content under txData and sends important server events to Saucin AI over outbound HTTPS. It does not expose a Windows port, use txAdmin credentials, execute commands, or restart resources.

## Before installation

1. Add a random value of at least 32 characters to the Saucin AI `.env` on Unraid as `TXADMIN_COLLECTOR_TOKEN`.
2. Deploy/restart Saucin AI so both the API and dashboard receive that value.
3. Download this `txadmin-collector` folder to the Windows 11 server.

Generate a token on Unraid with:

```bash
openssl rand -hex 32
```

## Install

Open **PowerShell as Administrator**, change into the downloaded folder, and run:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\install.ps1
```

The installer is preconfigured for:

```text
C:\Users\mgsau\Desktop\Saucin qbox\txData
```

It prompts for the token, installs under `C:\ProgramData\SaucinAI\txadmin-collector`, locks the folder to Administrators and SYSTEM, creates a startup scheduled task, and starts it immediately.

The dashboard should show **Collector online** within 30 seconds. The collector starts at the end of existing log files, so old logs are not uploaded; new warnings and errors appear as they happen.

## Troubleshooting

- Task Scheduler task: `SaucinAI-txAdmin-Collector`
- Local collector log: `C:\ProgramData\SaucinAI\txadmin-collector\collector.log`
- Local unsent queue: `C:\ProgramData\SaucinAI\txadmin-collector\pending.json`
- Dashboard: `https://ai.saucinrp.com/txadmin`

The queue retains up to 2,000 redacted events during a network outage and retries them automatically.

## Uninstall

```powershell
.\uninstall.ps1
```

Add `-RemoveData` only if you also want to delete the saved token, cursor state, and unsent queue.
