-- CreateTable: group_assignment_history
-- Tracks which AAD groups each app has been assigned to (used for MRU "Recently used" list)
CREATE TABLE [dbo].[group_assignment_history] (
    [id]        INT NOT NULL IDENTITY(1,1),
    [groupId]   NVARCHAR(1000) NOT NULL,
    [groupName] NVARCHAR(1000) NOT NULL,
    [groupType] NVARCHAR(1000) NOT NULL,
    [intent]    NVARCHAR(1000) NOT NULL,
    [appId]     NVARCHAR(1000) NOT NULL,
    [usedAt]    DATETIME2 NOT NULL CONSTRAINT [group_assignment_history_usedAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [group_assignment_history_pkey] PRIMARY KEY CLUSTERED ([id])
);
