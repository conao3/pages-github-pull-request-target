{
  description = "Development environment for pages-github-pull-request-target";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
  };

  outputs =
    { nixpkgs, ... }:
    let
      systems = [
        "aarch64-darwin"
        "aarch64-linux"
        "x86_64-linux"
      ];

      forAllSystems =
        f:
        nixpkgs.lib.genAttrs systems (
          system:
          f {
            pkgs = import nixpkgs { inherit system; };
          }
        );
    in
    {
      devShells = forAllSystems (
        { pkgs }:
        with pkgs;
        let
          nodejs = if pkgs ? nodejs_24 then nodejs_24 else pkgs.nodejs;
        in
        {
          default = mkShell {
            packages = [
              nodejs
              pnpm
              bun
              gh
              wrangler
              lefthook
            ];

            shellHook = ''
              export npm_config_update_notifier=false

              echo "Node.js $(node --version)"
              echo "pnpm $(pnpm --version)"
              echo "Bun $(bun --version)"

              # Install dependencies only if node_modules/.pnpm/lock.yaml is older than pnpm-lock.yaml
              if [ ! -f node_modules/.pnpm/lock.yaml ] || [ pnpm-lock.yaml -nt node_modules/.pnpm/lock.yaml ]; then
                echo "📦 Installing dependencies..."
                pnpm install --frozen-lockfile
              fi

              # Install lefthook git hooks if they are missing or outdated
              if [ -f lefthook.yaml ] && [ ! -f .git/hooks/pre-commit -o lefthook.yaml -nt .git/hooks/pre-commit ]; then
                lefthook install >/dev/null
              fi
              '';
          };
        }
      );

      apps = forAllSystems (
        { pkgs }:
        with pkgs;
        let
          mkPnpmApp =
            name: args: {
              type = "app";
              program = toString (
                writeShellScript "pnpm-${name}" ''
                  set -euo pipefail
                  cd "$(${git}/bin/git rev-parse --show-toplevel)"
                  if [ ! -d node_modules ]; then
                    ${pnpm}/bin/pnpm install --frozen-lockfile
                  fi
                  exec ${pnpm}/bin/pnpm ${args}
                ''
              );
            };

          mkBunScript = name: {
            type = "app";
            program = toString (
              writeShellScript "bun-${name}" ''
                set -euo pipefail
                cd "$(${git}/bin/git rev-parse --show-toplevel)"
                exec ${bun}/bin/bun scripts/${name}.ts "$@"
              ''
            );
          };
        in
        {
          check = mkPnpmApp "check" "check";
          build = mkPnpmApp "build" "build";
          generate-data = mkBunScript "generate-data";
          print-summary = mkBunScript "print-summary";
          update-data-local = mkBunScript "update-data-local";
        }
      );
    };
}
