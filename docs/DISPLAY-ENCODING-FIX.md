# Display encoding correction

The fixed firmware source is a65ce80034703308a3c3c24acbfbaef2e0e5eb3c. Full Linux CI passed: https://github.com/bfrye26/MoCI/actions/runs/43421823907. The local launcher is pinned to this source for the next full build.

The rc.2 source transfer through the Windows console damaged non-ASCII characters. The dashboard down arrow became U+0019, and several other symbols became question marks. The page declared UTF-8 correctly; the payload was already damaged. The fonts use local system fallbacks and have no external font dependency.

The canonical local UTF-8 source is restored using ASCII-escaped JSON transport to GitHub. This preserves character code points independently of the Windows console code page. The frontend build now runs tests/text-encoding.test.mjs, which rejects unexpected control/replacement characters and checks the four dashboard symbols explicitly.

The local frontend build passed. Apply-MoCI-Core-Fixes.ps1 now includes the stylesheet, dashboard and advanced modules as well as the original core/network/system files and HTML. It backs up existing files and does not change router settings.

The next full firmware candidate is 0.11.1-rc.3. The previously built rc.2 image remains identifiable and must not be relabelled as fixed. Visual verification on the installed VM is still required after applying the update.

The odhcpd warning about no default route refers to IPv6 router advertisements. The release check now reports whether an IPv6 default route exists without changing RA or forcing gateway advertisements. IPv4 success does not prove IPv6 upstream availability.
