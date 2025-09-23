[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](
  https://github.com/codespaces/new?hide_repo_select=true&ref=main&repo=ttranslucent%2Fnepsis-utf8-ab-harness
)

# Nepsis UTF-8 → NFC A/B Harness

Public access harness for reproducing **A/B constraint satisfaction**:  
*same model, different architecture.*

---

## Run

Click the badge above to launch in GitHub Codespaces.  
Then:

```bash
# Paste your model's Utf8StreamNormalizer into solution.py
PYTHONPATH=. pytest -q
```
## Important

This repository contains only the public test harness (tests + stub).
The Nepsis scaffold prompt/code is proprietary and excluded from this repo and license.

For consideration of formal evaluation access under NDA, contact:
📧 ttranslucent@gmail.com
