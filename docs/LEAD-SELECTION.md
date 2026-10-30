# Lead selection across pages

The Leads table keeps selected lead IDs while moving between pages. The header checkbox selects or clears only the current visible page. The selected count and bulk actions include all selected pages.

Changing the search, status, date, source, assignee, or other filter scope clears the selection. Bulk delete uses only the selected IDs, takes its existing backup, and never turns the page checkbox into a delete-all request.

2026-10-30: Corrected the page-fetch reset and made the checkbox and delete scope consistent. Verification: release checkout TypeScript check and diff check pass; the local full implementation previously passed a webpack build and lead-filter checks. A production browser smoke test remains necessary after deployment.
