# Documentation media

[Back to README](../../README.md)

## Captured

- [landing.png](landing.png): actual unmodified local landing page captured on
  2026-10-29, default browser viewport. Its animated demonstration is labelled Demo;
  it is not evidence of a real upload. No authenticated/private file data is shown.

## TODO: add screenshots

The dashboard redirected to sign-in during the documentation pass. Do not use
mock/review pages or generated imagery as substitutes for these real captures:

| Planned filename | Exact capture needed |
| --- | --- |
| upload-in-progress.png | Sign in; start a synthetic 100 MiB+ file; capture the court with up to five hovering/ringed balls, at least one scoring/confirmed piece, and the compact dock's single status line. |
| upload-paused.png | Pause that upload; capture retained saved count, Resume/Cancel controls and all unsaved hover balls returned to the floor. |
| my-files.png | Complete the synthetic upload; capture /dashboard?view=files, its file row and completed-only usage total. |
| bin.png | Move only that synthetic file to Bin; capture /dashboard?view=bin with Restore and permanent-delete controls. |

Use synthetic filenames, hide account-identifying text and private files, and check
that the screenshots match the current app. Do not edit the page into a fake state.
The following are **pending templates**, not enabled image links:

```markdown
<!-- TODO: add these four real screenshots, then enable the links -->
![Upload in progress](docs/media/upload-in-progress.png)
![Paused upload](docs/media/upload-paused.png)
![My files](docs/media/my-files.png)
![Bin](docs/media/bin.png)
```

These paths are relative to the root README, where the templates should be enabled
once the corresponding images exist. Pending filenames are deliberately not
rendered as broken images in the published README.
