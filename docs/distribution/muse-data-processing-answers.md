# Discriminantly: Muse Connector Platform, data processing (§5.2 / §5.3)

**Draft for Brian's review. Not legal advice.**

## §5.2 Privacy policy URL

https://www.discriminantly.com/privacy (updated 12 October 2026, v2.86)

## §5.3 Data-processing answers

These match the published policy word for word in substance. Edits to the proposed answers are marked **[amended]**, with the reason.

### Data accessed

The connecting member's own Discriminantly account: notes, travel marks, check-ins, itineraries, recommendations, collections, ensembles, comments, ownership and warrant records, and their images. Access is limited by the connection key's permission:
- a **full-access** key can read and act on everything in the member's account, including private records;
- a **read-only** key can read only, and every write is refused.

The connector also reads other members' **public** notes and comments, with their handles, as anyone viewing the site would see them.

**[amended]** The proposed answer listed only notes, marks, itineraries, check-ins and recommendations. The tools also return collections, ensembles, comments, ownership and warrant records, images, and other members' public content with handles.

### Purpose

To retrieve the member's saved context and to carry out actions the member asks for through Muse: capture (notes, travel marks, check-ins), trip planning, and recommendation workflows.

*(Unchanged.)*

### Protection

- **In transit:** all traffic uses TLS (HTTPS).
- **Credentials:** each connection has its own key. Keys are stored only as hashes, are shown to the member once, and can be revoked one at a time in Settings. Revoking takes effect immediately and deletes nothing.
- **Read-only keys:** enforced on the server. Any write tool is refused before it runs.
- **Who sees private records:** only the member, and services the member has connected through that member's own credential. Two exceptions:
  1. On a plan the member chooses to share, invited participants see the names and addresses of its places. The member confirms this before inviting anyone.
  2. The operator can access stored data when needed to run, secure or support the service.
- **Attribution:** every action a connected AI service takes is recorded in provenance as that service (for example `agent: muse`) acting for the member.

**[amended]** The proposed answer said "private records accessible only through that member's authorization". That leaves out the shared-plan exception and operator access, both of which the policy states.

### Sharing

- Member data is never sold and is not shared with advertisers.
- Data goes to a connected AI service only when the member has authorized that connection and uses it.
- Service providers process data only as needed to run Discriminantly:
  - **Railway** hosts the service and stores the data.
  - **Photon (Komoot)** receives place details only: name, address, city, country. It never receives notes, visits or account data.

**[amended]** The proposed answer didn't name the service providers. The policy does, so the submission should too.

### Retention and deletion

- Records persist until the member deletes them. Deleted records leave a provenance trace and can remain in backups until those are removed.
- Deleting records and revoking a connection are separate actions: revoking deletes nothing, and deleting doesn't disconnect.
- Members can delete their own account in Settings. Deletion takes effect immediately and removes:
  - all the account's records and photos;
  - the plans it owns;
  - its history of changes;
  - every AI connection.

  Copies can remain in backups until those are removed.
- Export is by email request to brianelicierto@mac.com.
