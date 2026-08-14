| Dependency | Role |
|---|---|
| Pi | Loads the package manifest and executes or presents its resources. |
| Node.js 20 or newer | Runtime baseline declared by the package. |
| awf | Pinned development tool that renders and checks the repository workflow. |

The package currently has no npm runtime or development dependencies. Add extension runtime libraries to `dependencies`; list imported Pi core packages in `peerDependencies` with a `*` range.
