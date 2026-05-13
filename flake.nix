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
        "x86_64-darwin"
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
        let
          nodejs =
            if pkgs ? nodejs_24 then
              pkgs.nodejs_24
            else
              pkgs.nodejs;
        in
        {
          default = pkgs.mkShell {
            packages = [
              nodejs
              pkgs.pnpm
              pkgs.gh
            ];

            shellHook = ''
              export npm_config_update_notifier=false

              echo "Node.js $(node --version)"
              echo "pnpm $(pnpm --version)"
              echo "Run: pnpm install --frozen-lockfile"
            '';
          };
        }
      );
    };
}
