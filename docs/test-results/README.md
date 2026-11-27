# Test execution results (Phase IV, issue #16)

The 420 Phase III test cases, in one sheet per designer.  Rayan El Chaar executed the cases from 20 to 24 November
2026 on his laptop, and signed each executed row (**Executed by**, **Execution date**).  The **Designed by** column
keeps the member who designed the case in Phase III.

| Designer | File | Cases | Pass | Fail | Not run |
| --- | --- | --- | --- | --- | --- |
| Rayan El Chaar | [rayan-el-chaar.xlsx](rayan-el-chaar.xlsx) | 124 | 123 | 0 | 1 |
| Jean-Marie Agha | [jean-marie-agha.xlsx](jean-marie-agha.xlsx) | 74 | 68 | 0 | 6 |
| Ramez Naba | [ramez-naba.xlsx](ramez-naba.xlsx) | 74 | 72 | 0 | 2 |
| Adam Jaat | [adam-jaat.xlsx](adam-jaat.xlsx) | 74 | 56 | 0 | 18 |
| Mohamad Moubarak | [mohamad-moubarak.xlsx](mohamad-moubarak.xlsx) | 74 | 69 | 3 | 2 |
| **All** | | **420** | **388** | **3** | **29** |

## How the cases were run

- **Automated (npm test):** the Jest suite on an up-to-date `main`, each test named after its test case.
- **Browser, API and tools on the laptop:** the scripts and checks named in the **Method** and **Notes** columns
  (load and scale scripts in `server/perf/`, axe-core, the fresh-clone README check), on a scratch database.
- **Review:** the report, the diagrams, the repository settings and OpenProject, against the expected result.
- **CI pipeline (GitHub Actions):** test pull requests #66, #67 and #68, opened against the pipeline of #65 and closed
  without merging.

## Failed cases

Every failed case has its fix in its own pull request and is run again once the fix is merged.  Cases that
passed when run again keep their first failure in **Notes**.

| Case | What failed | Fix |
| --- | --- | --- |
| TC-FR-2.5-D | A post sent without a category or building got "Invalid input" from the API | #48, merged; passed when run again |
| TC-NFR-24.3-D | An injected advertising script ran: the client pages had no content security policy | #49, merged; passed when run again |
| TC-NFR-15.3-V | No server module had a README | #50, merged; passed when run again |
| TC-NFR-19.2-D | Nothing checked the licences of the dependencies | #51, merged; passed when run again |
| TC-NFR-22.1-V | No privacy notice; notifications were never deleted after 6 months | #52, merged; passed when run again |
| TC-NFR-18.3-V | Five merged pull requests (#21, #22, #38, #39, #41) named no task | Descriptions linked to their work packages on 20 November; passed when run again |
| TC-NFR-18.1-V, TC-NFR-18.1-D | The plan has phases and milestones, not two-week sprints with review records | Process: none |
| TC-NFR-18.2-V | No merged pull request was approved by another member (required approvals set to 0) | Required approvals set back to 1 on 20 November; #57 (23 November) was the first merged pull request approved by another member |

TC-NFR-21.2-D passed for signed-in users on its first run, but a new sign-in during the mail outage got a
generic error; fixed in #53 (merged), it now gets a clear 503 message.  The scale results of NFR-14 are in [security-performance.md](../security-performance.md).

## Cases not run

- **Not run (29):** the production setup of Appendix A (hosting, firewall, backups, monitoring), browsers the
  laptop does not have (NFR-8.1), the review of the rules of use with LAU (NFR-23.1-V), and the usability test
  with participants (NFR-6.1 to 6.3), which did not take place before the submission.  Each keeps its reason in
  **Notes**.  The defect found while preparing the usability test (TC-NFR-6.2-D: no reason shown when a user
  opens their own post) was fixed in #58.
- TC-NFR-7-V passed on 23 November: axe-core found no violation, and every page was used with VoiceOver.
- TC-NFR-21.1-V and -D passed on 24 November: release [v1.0.0](https://github.com/RayanChaar1/FoundU/releases/tag/v1.0.0)
  came 8 days before the deadline, and no High-priority case was failing when it was tagged.
- TC-NFR-15.1-D, TC-NFR-15.2-D and TC-NFR-18.3-D passed on 24 November with the CI pipeline of #65: a lint error
  (#66) and business-logic coverage of 64.94% (#67) failed required checks, so the merge was blocked, and a
  description without a task (#68) failed the Task reference check.
