-- CreateTable: wt_detected_updates
-- Tracks the first time each WinTuner update (packageId + latestVersion) was detected.
-- Used to calculate update age: auto-update eligible when first_seen_at > 7 days ago.
CREATE TABLE [dbo].[wt_detected_updates] (
    [id]             INT           NOT NULL IDENTITY(1,1),
    [package_id]     NVARCHAR(255) NOT NULL,
    [latest_version] NVARCHAR(100) NOT NULL,
    [first_seen_at]  DATETIME2     NOT NULL CONSTRAINT [wt_detected_updates_first_seen_at_df] DEFAULT GETDATE(),
    CONSTRAINT [wt_detected_updates_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [wt_detected_updates_package_id_latest_version_key] UNIQUE ([package_id], [latest_version])
);
