# nlp-nexterp-scraper

**nlp-nexterp-scraper** is an engine designed to log in with [NextERP](https://nlp.nexterp.in), fetch the feeds, and transform it into a clean, structured JSON API. 
The goal of this project is to decouple NextERP's data from its default interface, allowing you to build more modern web-uis.

---

## Links
*   **Live Demo:** [rijash.com](https://rijash.com)
*   **Stable Version:** [NextOS-But-Better](https://github.com/Deadly-BLOCK/NextOS-But-Better)
*   **Official Portal:** [NextOS](https://nlp.nexterp.in/)

---

## How it Works
The scraper acts as a middlemen between the NextERP and your custom frontend:

1.  Auth: Authenticates using your own provided user credentials.
2.  Fetch: Requests the raw feed data from the portal.
3.  Serve: Provides the data needed.

---

## ⚠️ Disclaimer
**This tool is unofficial and not affiliated with NextERP.**

*   **Experimental:** This is a research-heavy repository. Expect breaking changes as we optimize the scraping logic.
*   **Stability:** If you require a production-ready environment, please use the [Stable Repo](https://github.com/Deadly-BLOCK/NextOS-But-Better).
*   **Usage:** Use responsibly. Ensure you comply with your institution's digital privacy policies.

**This tool is not a piracy utility.** It requires valid user credentials and only gets data accessible to your account. No media or content is downloaded; the tool merely extracts existing URLs from the portal feed, which seems to expire within exactly 2 hours.
