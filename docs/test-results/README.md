# Test execution results (Phase IV, issue #16)

The 420 Phase III test cases, in one sheet per designer.  Rayan El Chaar executed every case on 20 November 2026
on his laptop, and signed each executed row (**Executed by**, **Execution date**).  The **Designed by** column
keeps the member who designed the case in Phase III.

| Designer | File | Cases | Pass | Fail | Not run | To execute |
| --- | --- | --- | --- | --- | --- | --- |
| Rayan El Chaar | [rayan-el-chaar.xlsx](rayan-el-chaar.xlsx) | 124 | 123 | 0 | 1 | 0 |
| Jean-Marie Agha | [jean-marie-agha.xlsx](jean-marie-agha.xlsx) | 74 | 67 | 1 | 0 | 6 |
| Ramez Naba | [ramez-naba.xlsx](ramez-naba.xlsx) | 74 | 71 | 0 | 2 | 1 |
| Adam Jaat | [adam-jaat.xlsx](adam-jaat.xlsx) | 74 | 56 | 0 | 18 | 0 |
| Mohamad Moubarak | [mohamad-moubarak.xlsx](mohamad-moubarak.xlsx) | 74 | 56 | 8 | 5 | 5 |
| **All** | | **420** | **373** | **9** | **26** | **12** |

## How the cases were run

- **Automated (npm test):** the Jest suite on an up-to-date `main`, each test named after its test case.
- **Browser, API and tools on the laptop:** the scripts and checks named in the **Method** and **Notes** columns
  (load and scale scripts in `server/perf/`, axe-core, the fresh-clone README check), on a scratch database.
- **Review:** the report, the diagrams, the repository settings and OpenProject, against the expected result.

## Failed cases

Every failed case has its fix in its own pull request and is run again once the fix is merged.

| Case | What failed | Fix |
| --- | --- | --- |
| TC-FR-2.5-D | A post sent without a category or building got "Invalid input" from the API | #48 |
| TC-NFR-24.3-D | An injected advertising script ran: the client pages had no content security policy | #49 |
| TC-NFR-15.3-V | No server module had a README | #50 |
| TC-NFR-19.2-D | Nothing checked the licences of the dependencies | #51 |
| TC-NFR-22.1-V | No privacy notice; notifications were never deleted after 6 months | #52 |
| TC-NFR-18.3-V | Four merged pull requests (#21, #22, #39, #41) named no task | Descriptions linked to their work packages on 20 November |
| TC-NFR-18.1-V, TC-NFR-18.1-D | The plan has phases and milestones, not two-week sprints with review records | Process: none |
| TC-NFR-18.2-V | No merged pull request was approved by another member (required approvals set to 0) | Process: approvals back to 1 |

TC-NFR-21.2-D passed for signed-in users; the generic error a new sign-in got during the mail outage is fixed
in #53.  The scale results of NFR-14 are in [security-performance.md](../security-performance.md).

## Cases not run or still to execute

- **Not run (26):** the production setup of Appendix A (hosting, firewall, backups, monitoring), browsers the
  laptop does not have (NFR-8.1), and the review of the rules of use with LAU (NFR-23.1-V).  Each keeps its
  reason in **Notes**.
- **To execute (12):** the usability test with participants (NFR-6.1 to 6.3), the VoiceOver part of NFR-7-V,
  the release (NFR-21.1), the review of the AI credit in the report (NFR-24.1-V), and the cases that need the
  required approvals back at 1 (NFR-18.2-D, NFR-24.1-D).
