# Internal testing and distribution policy

TeXWeave is proprietary during the 0.6.x testing period. It is not currently
released under an open-source license. The `UNLICENSED` package metadata and
root `LICENSE` make that status explicit and help prevent accidental
publication as an open-source npm package.

## Internal source access

Internal testers who need to inspect or change the code should receive access
to the private source repository through the organization's existing account,
confidentiality, and acceptable-use policies. Keep the repository private,
grant access only to named testers, require two-factor authentication where
available, and review access when a tester leaves the program. Removing remote
access cannot erase copies or clones that someone already downloaded, so the
confidentiality terms should address local copies as well.

Making source available to a restricted internal group is not the same as an
open-source release. If a tester is outside the organization, grant source
access only under a separate written evaluation or contractor agreement that
covers confidentiality, permitted use, retention/deletion, and feedback/IP
terms. The project owner and the applicable agreement should be confirmed by
the organization before onboarding those testers.

## External binary testing

External testers should receive only the versioned Windows x64 portable
executable from `release/<version>/`. Give each tester the test terms before
download: the build is for evaluation, who may use it, whether it may be copied
to another test device, how to report problems, and how long test data should
be retained. Do not describe this binary as open source. Keep downloads behind
an authenticated, access-controlled channel if the test is invitation-only;
a public download link can be forwarded.

Provide a SHA-256 checksum beside each build and communicate whether it is
signed. A checksum helps detect accidental corruption when the tester obtains
the checksum through a trusted channel; it does not identify the publisher.
Signing can help Windows identify the publisher, but a new signed test build
can still trigger a SmartScreen prompt.

## Third-party components

The project's proprietary status does not replace the licenses for Electron,
runtime packages, fonts, icons, dictionaries, or other third-party materials.
Before sharing an executable outside the organization, inventory the actual
packaged runtime dependencies and any bundled or downloaded resources, verify
their license texts and attribution requirements, and include a reviewed
`THIRD-PARTY-NOTICES` file with the download. Treat automated SBOM and license
reports as review inputs; resolve unknown, copyleft, and conflicting entries
before wider distribution.

Spell-check resources deserve a specific review: the application records
multiple possible licenses for the bundled Kazakh dictionary and downloads
license texts for some language resources. Confirm which exact versions and
files are included in a given test package and preserve the applicable notices.

## Opening the project later

When the project is ready for a public open-source release, choose the license
and copyright holders deliberately, audit contributors and third-party
materials, replace `UNLICENSED`, add the complete license text, and review the
source and binary distribution notices together. Do not publish the repository
or change it to a public license until that review is complete.
