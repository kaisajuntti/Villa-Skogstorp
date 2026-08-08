# Villa Skogstorp

Digital hub för renovering och tillbyggnad av Villa Skogstorp (Karlshamn 5:1).

- **Översikt** — situationsplanen som ingång; klicka på en byggnad/yta för att öppna zonen
- **Rum** — varje rum har en rumsplanerare (mm-exakt 2D-planering) plus färger, dokument
  och anteckningar
- **Projekt** — övergripande dokument (inkl. situationsplan-PDF), färgschema,
  anteckningar samt export/import av all data (JSON)

All data sparas lokalt i webbläsaren (localStorage) — använd Export på projektsidan som
backup och för att flytta mellan enheter.

## Utveckling

```
npm install
npm run dev      # lokal server
npm run build    # produktion → dist/
```

Deploy: GitHub Actions → GitHub Pages på push till `main`
(kräver att projektet ligger i ett eget repo — se CLAUDE.md "Deployment status").
