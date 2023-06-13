# ACH File Reader

Use the app [here](https://alexmerkertls.github.io/ach-reader/).

This page reads in ACH files in the format described [here](https://achdevguide.nacha.org/ach-file-overview).
More details on each field can be found [here](https://achdevguide.nacha.org/ach-file-details).

## Functions

### Choose File

Opens a file selection dialog that allows you to select an ACH file to load. The file is loaded upon confirmation.

### Reload File

Reloads the selected file from your machine.

### Reset Errors

Resets any fields in an error state to their true value (values in error have not been updated in the underlying data).

### Save

Downloads the updated ACH file.