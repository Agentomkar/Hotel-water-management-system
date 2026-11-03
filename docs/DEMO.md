# Demo script (~6 minutes)

Open `index.html` (or `dist/hydrogarden.html` after `npm run build`) — no server, no internet.

1. **Dashboard (1 min).** Read the amber box first: *the current-use figure is a model, not a meter; the saving is 58–68%, centred near 63%.* Say it before anyone asks.
2. **Where the savings come from.** Drip conversion and the rain sensor lead. Point at the note that ~37% of the saving falls in June–September and depends on the assumption that timers keep running in the monsoon.
3. **Garden Zones (1 min).** Switch Main Lawn from fixed spray to drip in the editor; the dashboard, plan colours and audit all move. This proves it is an engine.
4. **Portfolio (1 min).** Load the 12-hotel sample; open the top hotel. Say what the dataset is (synthetic), and that it is used to test scale, not to prove savings.
5. **Water Audit.** Findings carry engine-computed figures; "not quantified" is deliberate.
6. **Simulator (1 min).** Start in April, *Run 30 days*; then start in July. Dry season and monsoon give very different savings; *Run a full year* lands near the annual figure.
7. **Rain & Greywater.** Set the tank to 0, then 60 m³ — coverage changes; greywater carries the dry months.
8. **Assumptions.** Finish here. The next step is one metered zone.

**The honest line:** *The software is finished and tested. The saving is a model of an assumed baseline — metering one zone is what turns it into a result.*

**Likely questions.** *Where does 63% come from?* Five measures, Shapley-attributed; sum equals the total. *Why not ML?* The dataset's labels are a lookup table (docs/DATASET.md) and there is no measured data yet. *Is the dataset real?* No, synthetic.
