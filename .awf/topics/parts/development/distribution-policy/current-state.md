This topic records how the project makes its source and package resources available.

## Claims

### `rule: public-git-distribution`

The repository is public and licensed as `AGPL-3.0-only` with the exact GNU Affero General Public License version 3 text. Consumers install and pin tagged Git refs without repository credentials. `package.json` retains `private: true` to prevent npm publication; changing that guard or adding a publication artifact requires a new distribution-policy decision.
