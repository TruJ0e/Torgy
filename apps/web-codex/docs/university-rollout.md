# University rollout checklist

- Microsoft: register an Entra app, tenant ID, exact redirect URI, delegated `Calendars.Read`, and obtain admin consent only if the tenant requires it.
- Canvas: institutional Developer Key, OAuth redirect URI, and minimal read scopes for user, active courses, assignments, planner/calendar, and unambiguous submission state.
- Copilot: confirm Edge UI automation is permitted, uses the legitimate user session, contains no student data in smoke tests, and operates only in the approved university environment.
- Hosting: approved private environment, TLS, PostgreSQL migration plan, backups/restores, Entra identity, centralized advisor assignment, retention policy, accessibility and FERPA review.
