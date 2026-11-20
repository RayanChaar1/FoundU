# Test execution results (Phase IV, issue #16)

Each member executes the Phase III test cases they designed and adds the signed sheet here, through their own
pull request.  The sheets are filled as described in the execution guide that comes with them.

| Member | File | Cases | Status |
| --- | --- | --- | --- |
| Rayan El Chaar | [rayan-el-chaar.xlsx](rayan-el-chaar.xlsx) | 124 | Executed: 123 pass, 1 not run (NFR-10.3-D, production setup) |
| Jean-Marie Agha | `jean-marie-agha.xlsx` | 74 | To add |
| Ramez Naba | `ramez-naba.xlsx` | 74 | To add |
| Adam Jaat | `adam-jaat.xlsx` | 74 | To add |
| Mohamad Moubarak | `mohamad-moubarak.xlsx` | 74 | To add |

## Adding your sheet

1. Run `npm test` and `npm run lint` on an up-to-date `main`, then execute the manual cases of your sheet.
2. Fill **Actual result**, **Status**, **Executed by** (your name) and **Execution date** for every row.
3. Commit it from your own GitHub account:

   ```bash
   git switch main && git pull
   git switch -c test-results-<your-name>
   cp "<your sheet>.xlsx" docs/test-results/<your-name>.xlsx
   git add docs/test-results/<your-name>.xlsx
   git commit -m "Test execution results: <your name>"
   git push -u origin test-results-<your-name>
   ```

4. Open a pull request on GitHub, link it to issue #16, and update your row in the table above in the same
   pull request.

A failed case is recorded as Fail with what happened; it is fixed in its own pull request and run again.
Cases marked "Not run" need the production setup of Appendix A and keep the reason given in Notes.
