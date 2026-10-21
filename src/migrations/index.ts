import * as migration_20261021_041309_initial_community from './20261021_041309_initial_community';
import * as migration_20261021_051136_content_foundation from './20261021_051136_content_foundation';
import * as migration_20261021_053108_media_origin_index from './20261021_053108_media_origin_index';
import * as migration_20261021_103842_invitation_accounts from './20261021_103842_invitation_accounts';
import * as migration_20261021_104900_account_invariants from './20261021_104900_account_invariants';
import * as migration_20261021_113451_publication_management from './20261021_113451_publication_management';

export const migrations = [
  {
    up: migration_20261021_041309_initial_community.up,
    down: migration_20261021_041309_initial_community.down,
    name: '20261021_041309_initial_community',
  },
  {
    up: migration_20261021_051136_content_foundation.up,
    down: migration_20261021_051136_content_foundation.down,
    name: '20261021_051136_content_foundation',
  },
  {
    up: migration_20261021_053108_media_origin_index.up,
    down: migration_20261021_053108_media_origin_index.down,
    name: '20261021_053108_media_origin_index',
  },
  {
    up: migration_20261021_103842_invitation_accounts.up,
    down: migration_20261021_103842_invitation_accounts.down,
    name: '20261021_103842_invitation_accounts',
  },
  {
    up: migration_20261021_104900_account_invariants.up,
    down: migration_20261021_104900_account_invariants.down,
    name: '20261021_104900_account_invariants',
  },
  {
    up: migration_20261021_113451_publication_management.up,
    down: migration_20261021_113451_publication_management.down,
    name: '20261021_113451_publication_management'
  },
];
