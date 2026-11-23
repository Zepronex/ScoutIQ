# Screenshots

These images come from the running app with a real FPL snapshot. Regenerate them after a visible change:

```sh
pnpm run dev
SCOUTIQ_WEB_URL=http://localhost:3000 node scripts/capture-screenshots.mjs
```

Set `SCOUTIQ_BROWSER_CHANNEL=chrome` to use an installed Chrome. The script generates a fresh draft squad, so it needs current projections in the database and nothing saved in the browser.

| File | View |
| --- | --- |
| `home.png` | Home page with the deadline countdown and top projections |
| `squad-builder.png` | Squad builder after generating a £100.0m draft |
| `gameweek-plan.png` | Recommended XI on the pitch, bench order and transfer comparison |
| `gameweek-plan-phone.png` | The same plan at phone width |
| `top-players.png` | Player projections table |
| `model.png` | Backtest results against the benchmark |
