# Third-party components

The apps use the following packages. They are restored from NuGet at build time (not stored here), and keep their own licences. Check the current terms before redistributing.

| Component | Used by | Licence (as published by the authors) |
|---|---|---|
| Microsoft.WindowsAppSDK `2.2.2-experimental9` | all apps | Microsoft software licence terms, see the NuGet package |
| Microsoft.Windows.SDK.BuildTools `10.0.26100.4654` | all apps | Microsoft software licence terms, see the NuGet package |
| UglyToad.PdfPig `1.7.0-custom-5` | apps that read PDF text | Apache-2.0 |
| fo-dicom `5.1.2` | ReadingRoomAssistantApp | Microsoft Public License (MS-PL) |
| fo-dicom.Imaging.ImageSharp `5.1.2` (depends on SixLabors.ImageSharp) | ReadingRoomAssistantApp | Six Labors Split License (open-source use under Apache-2.0 terms; commercial use needs a licence from Six Labors) |
| WebView2 runtime | all apps | Microsoft Edge WebView2 Runtime licence |

`apps/AIShelfAuditorApp/www/assets` contains a **built, minified web bundle** (a React application). It embeds open-source libraries (React and its ecosystem, MIT) whose notices are not reproduced in the minified files.

All sample data (customers, résumés, transactions, invoices, DICOM studies, datasheets) was generated for these demos. The DICOM files were produced with pydicom and carry no patient information.
