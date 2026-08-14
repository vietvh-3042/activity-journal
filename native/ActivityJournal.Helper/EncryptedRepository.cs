using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Data.Sqlite;

namespace ActivityJournal.Helper;

public sealed partial class EncryptedRepository : IDisposable
{
    private readonly SqliteConnection connection;
    private readonly object gate = new();

    public EncryptedRepository(string dataDirectory)
    {
        Directory.CreateDirectory(dataDirectory);
        SQLitePCL.Batteries_V2.Init();
        var key = LoadOrCreateKey(Path.Combine(dataDirectory, "journal.key"));
        var databasePath = Path.Combine(dataDirectory, "activity-journal.db");
        connection = new SqliteConnection(new SqliteConnectionStringBuilder
        {
            DataSource = databasePath,
            Mode = SqliteOpenMode.ReadWriteCreate,
            Cache = SqliteCacheMode.Shared
        }.ToString());
        connection.Open();
        ExecuteRaw($"PRAGMA key = \"x'{Convert.ToHexString(key)}'\";");
        ExecuteRaw("PRAGMA cipher_compatibility = 4;");
        ExecuteRaw("PRAGMA foreign_keys = ON;");
        ExecuteRaw("PRAGMA journal_mode = WAL;");
        ExecuteRaw("PRAGMA synchronous = NORMAL;");
        Migrate();
    }

    public bool IsEncrypted => true;

    private static byte[] LoadOrCreateKey(string keyPath)
    {
        if (File.Exists(keyPath))
            return ProtectedData.Unprotect(File.ReadAllBytes(keyPath), null, DataProtectionScope.CurrentUser);

        var key = RandomNumberGenerator.GetBytes(32);
        var protectedKey = ProtectedData.Protect(key, null, DataProtectionScope.CurrentUser);
        var temporary = $"{keyPath}.{Guid.NewGuid():N}.tmp";
        File.WriteAllBytes(temporary, protectedKey);
        File.Move(temporary, keyPath, false);
        return key;
    }

    private void Migrate()
    {
        ExecuteRaw("""
            CREATE TABLE IF NOT EXISTS segments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                start_utc TEXT NOT NULL,
                end_utc TEXT NOT NULL,
                kind TEXT NOT NULL,
                app TEXT,
                title TEXT,
                domain TEXT,
                path TEXT,
                source TEXT NOT NULL,
                confidence TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_segments_start ON segments(start_utc);
            CREATE INDEX IF NOT EXISTS idx_segments_kind ON segments(kind);
            CREATE INDEX IF NOT EXISTS idx_segments_app ON segments(app);
            CREATE INDEX IF NOT EXISTS idx_segments_domain ON segments(domain);
            CREATE VIRTUAL TABLE IF NOT EXISTS segments_fts USING fts5(
                app, title, domain, path,
                content='segments', content_rowid='id',
                tokenize='unicode61 remove_diacritics 2'
            );
            CREATE TRIGGER IF NOT EXISTS segments_ai AFTER INSERT ON segments BEGIN
                INSERT INTO segments_fts(rowid, app, title, domain, path)
                VALUES (new.id, new.app, new.title, new.domain, new.path);
            END;
            CREATE TRIGGER IF NOT EXISTS segments_ad AFTER DELETE ON segments BEGIN
                INSERT INTO segments_fts(segments_fts, rowid, app, title, domain, path)
                VALUES ('delete', old.id, old.app, old.title, old.domain, old.path);
            END;
            CREATE TRIGGER IF NOT EXISTS segments_au AFTER UPDATE OF app, title, domain, path ON segments BEGIN
                INSERT INTO segments_fts(segments_fts, rowid, app, title, domain, path)
                VALUES ('delete', old.id, old.app, old.title, old.domain, old.path);
                INSERT INTO segments_fts(rowid, app, title, domain, path)
                VALUES (new.id, new.app, new.title, new.domain, new.path);
            END;
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS exclusions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                type TEXT NOT NULL,
                pattern TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS classification_rules (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                match_type TEXT NOT NULL,
                pattern TEXT NOT NULL,
                category TEXT,
                project TEXT
            );
            """);

        EnsureColumn("segments", "category", "TEXT");
        EnsureColumn("segments", "project", "TEXT");
        EnsureColumn("segments", "note", "TEXT");

        SetDefault("auto_start", "true");
        SetDefault("idle_threshold_seconds", "300");
        SetDefault("retention_days", "90");
        SetDefault("pause_indefinite", "false");
        SetDefault("pause_until_utc", "");
        using var count = connection.CreateCommand();
        count.CommandText = "SELECT COUNT(*) FROM exclusions";
        if (Convert.ToInt64(count.ExecuteScalar()) == 0)
        {
            using var insert = connection.CreateCommand();
            insert.CommandText = "INSERT INTO exclusions(type, pattern) VALUES ('app', 'Activity Journal')";
            insert.ExecuteNonQuery();
        }
    }

    public JournalSettings GetSettings()
    {
        lock (gate)
        {
            var exclusions = new List<ExclusionRule>();
            using (var command = connection.CreateCommand())
            {
                command.CommandText = "SELECT id, type, pattern FROM exclusions ORDER BY id";
                using var reader = command.ExecuteReader();
                while (reader.Read()) exclusions.Add(new(reader.GetInt64(0), reader.GetString(1), reader.GetString(2)));
            }
            var classificationRules = new List<ClassificationRule>();
            using (var command = connection.CreateCommand())
            {
                command.CommandText = "SELECT id, match_type, pattern, category, project FROM classification_rules ORDER BY id";
                using var reader = command.ExecuteReader();
                while (reader.Read()) classificationRules.Add(new(
                    reader.GetInt64(0), reader.GetString(1), reader.GetString(2),
                    reader.IsDBNull(3) ? null : reader.GetString(3),
                    reader.IsDBNull(4) ? null : reader.GetString(4)));
            }
            return new JournalSettings(
                GetBool("auto_start", true),
                GetInt("idle_threshold_seconds", 300),
                GetInt("retention_days", 90),
                exclusions,
                classificationRules);
        }
    }

    public JournalSettings UpdateSettings(JournalSettings settings)
    {
        var idle = Math.Clamp(settings.IdleThresholdSeconds, 60, 3600);
        var retention = Math.Clamp(settings.RetentionDays, 1, 3650);
        var rules = settings.Exclusions
            .Where(rule => rule is { Type.Length: > 0, Pattern.Length: > 0 })
            .Where(rule => new[] { "app", "domain", "title", "path" }.Contains(rule.Type, StringComparer.OrdinalIgnoreCase))
            .Take(200)
            .Select(rule => new ExclusionRule(null, rule.Type.ToLowerInvariant(), rule.Pattern.Trim()[..Math.Min(512, rule.Pattern.Trim().Length)]))
            .ToList();
        var classificationRules = (settings.ClassificationRules ?? [])
            .Where(rule => rule is { MatchType.Length: > 0, Pattern.Length: > 0 })
            .Where(rule => new[] { "app", "domain", "title" }.Contains(rule.MatchType, StringComparer.OrdinalIgnoreCase))
            .Where(rule => !string.IsNullOrWhiteSpace(rule.Category) || !string.IsNullOrWhiteSpace(rule.Project))
            .Take(200)
            .Select(rule => new ClassificationRule(
                null,
                rule.MatchType.ToLowerInvariant(),
                Limit(rule.Pattern.Trim(), 256)!,
                EmptyToNull(Limit(rule.Category?.Trim(), 64)),
                EmptyToNull(Limit(rule.Project?.Trim(), 128))))
            .ToList();

        lock (gate)
        {
            using var transaction = connection.BeginTransaction();
            SetSetting("auto_start", settings.AutoStart ? "true" : "false", transaction);
            SetSetting("idle_threshold_seconds", idle.ToString(), transaction);
            SetSetting("retention_days", retention.ToString(), transaction);
            using (var clear = connection.CreateCommand())
            {
                clear.Transaction = transaction;
                clear.CommandText = "DELETE FROM exclusions";
                clear.ExecuteNonQuery();
            }
            foreach (var rule in rules)
            {
                using var insert = connection.CreateCommand();
                insert.Transaction = transaction;
                insert.CommandText = "INSERT INTO exclusions(type, pattern) VALUES ($type, $pattern)";
                insert.Parameters.AddWithValue("$type", rule.Type);
                insert.Parameters.AddWithValue("$pattern", rule.Pattern);
                insert.ExecuteNonQuery();
            }
            using (var clear = connection.CreateCommand())
            {
                clear.Transaction = transaction;
                clear.CommandText = "DELETE FROM classification_rules";
                clear.ExecuteNonQuery();
            }
            foreach (var rule in classificationRules)
            {
                using var insert = connection.CreateCommand();
                insert.Transaction = transaction;
                insert.CommandText = "INSERT INTO classification_rules(match_type, pattern, category, project) VALUES ($type, $pattern, $category, $project)";
                insert.Parameters.AddWithValue("$type", rule.MatchType);
                insert.Parameters.AddWithValue("$pattern", rule.Pattern);
                insert.Parameters.AddWithValue("$category", Db(rule.Category));
                insert.Parameters.AddWithValue("$project", Db(rule.Project));
                insert.ExecuteNonQuery();
            }
            transaction.Commit();
        }
        return GetSettings();
    }

    public long Insert(ActivityInput input)
    {
        lock (gate)
        {
            using var command = connection.CreateCommand();
            command.CommandText = """
                INSERT INTO segments(start_utc, end_utc, kind, app, title, domain, path, source, confidence)
                VALUES ($start, $end, $kind, $app, $title, $domain, $path, $source, $confidence);
                SELECT last_insert_rowid();
                """;
            AddSegmentParameters(command, input.AtUtc, input.AtUtc, input);
            return Convert.ToInt64(command.ExecuteScalar());
        }
    }

    public void UpdateEnd(long id, DateTimeOffset endUtc)
    {
        lock (gate)
        {
            using var command = connection.CreateCommand();
            command.CommandText = "UPDATE segments SET end_utc = MAX(end_utc, $end) WHERE id = $id";
            command.Parameters.AddWithValue("$end", ToDb(endUtc));
            command.Parameters.AddWithValue("$id", id);
            command.ExecuteNonQuery();
        }
    }

    public void AttachPath(long id, string path)
    {
        lock (gate)
        {
            using var command = connection.CreateCommand();
            command.CommandText = "UPDATE segments SET path = $path, confidence = 'low' WHERE id = $id AND path IS NULL";
            command.Parameters.AddWithValue("$path", Limit(path, 2048));
            command.Parameters.AddWithValue("$id", id);
            command.ExecuteNonQuery();
        }
    }

    public void Redact(long id)
    {
        lock (gate)
        {
            using var command = connection.CreateCommand();
            command.CommandText = """
                UPDATE segments
                SET kind = 'excluded', app = NULL, title = NULL, domain = NULL, path = NULL,
                    source = 'privacy_filter', confidence = 'high'
                WHERE id = $id
                """;
            command.Parameters.AddWithValue("$id", id);
            command.ExecuteNonQuery();
        }
    }

    public IReadOnlyList<ActivitySegment> Search(SearchRequest request)
    {
        lock (gate)
        {
            var query = BuildFtsQuery(request.Query);
            var sql = new StringBuilder("SELECT s.id,s.start_utc,s.end_utc,s.kind,s.app,s.title,s.domain,s.path,s.source,s.confidence,s.category,s.project,s.note FROM segments s ");
            sql.Append("WHERE 1=1 ");
            using var command = connection.CreateCommand();
            if (query is not null)
            {
                sql.Append("AND (s.id IN (SELECT rowid FROM segments_fts WHERE segments_fts MATCH $query) OR instr(lower(coalesce(s.note,'') || ' ' || coalesce(s.project,'') || ' ' || coalesce(s.category,'')), lower($plain)) > 0) ");
                command.Parameters.AddWithValue("$query", query);
                command.Parameters.AddWithValue("$plain", request.Query!.Trim());
            }
            AddFilters(sql, command, request.FromUtc, request.ToUtc, request.Kinds, request.App, request.Domain);
            sql.Append("ORDER BY s.start_utc DESC LIMIT $limit OFFSET $offset");
            command.Parameters.AddWithValue("$limit", Math.Clamp(request.Limit ?? 250, 1, 1000));
            command.Parameters.AddWithValue("$offset", Math.Max(0, request.Offset ?? 0));
            command.CommandText = sql.ToString();
            return ReadSegments(command);
        }
    }

    public IReadOnlyList<ActivitySegment> Timeline(RangeRequest request)
    {
        lock (gate)
        {
            using var command = connection.CreateCommand();
            command.CommandText = """
                SELECT id,start_utc,end_utc,kind,app,title,domain,path,source,confidence,category,project,note
                FROM segments WHERE start_utc < $to AND end_utc >= $from
                ORDER BY start_utc ASC LIMIT 5000
                """;
            command.Parameters.AddWithValue("$from", ToDb(request.FromUtc));
            command.Parameters.AddWithValue("$to", ToDb(request.ToUtc));
            return ReadSegments(command);
        }
    }

    public IReadOnlyList<WeeklyStat> WeeklyStats(RangeRequest request)
    {
        lock (gate)
        {
            var results = new List<WeeklyStat>();
            foreach (var category in new[] { "app", "domain" })
            {
                using var command = connection.CreateCommand();
                command.CommandText = $"""
                    SELECT {category}, SUM(MAX(0, (julianday(MIN(end_utc,$to))-julianday(MAX(start_utc,$from)))*86400.0)) duration
                    FROM segments
                    WHERE start_utc < $to AND end_utc >= $from
                      AND kind IN ('active','browser') AND {category} IS NOT NULL AND {category} <> ''
                    GROUP BY {category} ORDER BY duration DESC LIMIT 20
                    """;
                command.Parameters.AddWithValue("$from", ToDb(request.FromUtc));
                command.Parameters.AddWithValue("$to", ToDb(request.ToUtc));
                using var reader = command.ExecuteReader();
                while (reader.Read()) results.Add(new(reader.GetString(0), category, reader.GetDouble(1)));
            }
            return results;
        }
    }

    public int Delete(DeleteRequest request)
    {
        lock (gate)
        {
            using var command = connection.CreateCommand();
            if (request.All == true)
            {
                command.CommandText = "DELETE FROM segments";
            }
            else
            {
                if (request.FromUtc is null || request.ToUtc is null || request.ToUtc <= request.FromUtc)
                    throw new ArgumentException("A valid deletion range is required");
                command.CommandText = "DELETE FROM segments WHERE start_utc < $to AND end_utc >= $from";
                command.Parameters.AddWithValue("$from", ToDb(request.FromUtc.Value));
                command.Parameters.AddWithValue("$to", ToDb(request.ToUtc.Value));
            }
            return command.ExecuteNonQuery();
        }
    }

    public int AnnotateSegments(AnnotateSegmentsRequest request)
    {
        if (request.Ids.Count is < 1 or > 500 || request.Ids.Any(id => id < 1)) throw new ArgumentException("Invalid segment IDs");
        lock (gate)
        {
            using var command = connection.CreateCommand();
            var ids = new List<string>();
            for (var index = 0; index < request.Ids.Distinct().Count(); index++) ids.Add($"$id{index}");
            var uniqueIds = request.Ids.Distinct().ToArray();
            command.CommandText = $"UPDATE segments SET category=$category, project=$project, note=$note WHERE id IN ({string.Join(',', ids)})";
            command.Parameters.AddWithValue("$category", Db(EmptyToNull(Limit(request.Category?.Trim(), 64))));
            command.Parameters.AddWithValue("$project", Db(EmptyToNull(Limit(request.Project?.Trim(), 128))));
            command.Parameters.AddWithValue("$note", Db(EmptyToNull(Limit(request.Note?.Trim(), 1000))));
            for (var index = 0; index < uniqueIds.Length; index++) command.Parameters.AddWithValue(ids[index], uniqueIds[index]);
            return command.ExecuteNonQuery();
        }
    }

    public int Cleanup(int retentionDays)
    {
        lock (gate)
        {
            using var command = connection.CreateCommand();
            command.CommandText = "DELETE FROM segments WHERE end_utc < $cutoff";
            command.Parameters.AddWithValue("$cutoff", ToDb(DateTimeOffset.UtcNow.AddDays(-Math.Clamp(retentionDays, 1, 3650))));
            var deleted = command.ExecuteNonQuery();
            ExecuteRaw("PRAGMA optimize;");
            return deleted;
        }
    }

    public (bool Indefinite, DateTimeOffset? Until) GetPauseState()
    {
        lock (gate)
        {
            var indefinite = GetBool("pause_indefinite", false);
            var raw = GetSetting("pause_until_utc");
            return (indefinite, DateTimeOffset.TryParse(raw, out var until) ? until : null);
        }
    }

    public void SetPauseState(bool indefinite, DateTimeOffset? until)
    {
        lock (gate)
        {
            SetSetting("pause_indefinite", indefinite ? "true" : "false");
            SetSetting("pause_until_utc", until is null ? "" : ToDb(until.Value));
        }
    }

    private static void AddFilters(StringBuilder sql, SqliteCommand command, DateTimeOffset? from, DateTimeOffset? to, IReadOnlyList<ActivityKind>? kinds, string? app, string? domain)
    {
        if (from is not null) { sql.Append("AND s.end_utc >= $from "); command.Parameters.AddWithValue("$from", ToDb(from.Value)); }
        if (to is not null) { sql.Append("AND s.start_utc < $to "); command.Parameters.AddWithValue("$to", ToDb(to.Value)); }
        if (kinds?.Count > 0)
        {
            var names = new List<string>();
            for (var index = 0; index < kinds.Count; index++)
            {
                var name = $"$kind{index}";
                names.Add(name);
                command.Parameters.AddWithValue(name, EnumName(kinds[index]));
            }
            sql.Append($"AND s.kind IN ({string.Join(',', names)}) ");
        }
        if (!string.IsNullOrWhiteSpace(app)) { sql.Append("AND s.app = $app "); command.Parameters.AddWithValue("$app", app); }
        if (!string.IsNullOrWhiteSpace(domain)) { sql.Append("AND s.domain = $domain "); command.Parameters.AddWithValue("$domain", domain); }
    }

    public static string? BuildFtsQuery(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        var tokens = SearchTokenPattern().Matches(value.ToLowerInvariant()).Cast<Match>()
            .Select(match => match.Value.Replace("\"", "\"\"", StringComparison.Ordinal))
            .Where(token => token.Length > 0)
            .Take(20)
            .Select(token => $"\"{token}\"*")
            .ToArray();
        return tokens.Length == 0 ? null : string.Join(" AND ", tokens);
    }

    [GeneratedRegex("[\\p{L}\\p{N}._-]+")]
    private static partial Regex SearchTokenPattern();

    private IReadOnlyList<ActivitySegment> ReadSegments(SqliteCommand command)
    {
        var results = new List<ActivitySegment>();
        using var reader = command.ExecuteReader();
        while (reader.Read())
        {
            results.Add(new ActivitySegment(
                reader.GetInt64(0),
                DateTimeOffset.Parse(reader.GetString(1)),
                DateTimeOffset.Parse(reader.GetString(2)),
                ParseEnum<ActivityKind>(reader.GetString(3)),
                reader.IsDBNull(4) ? null : reader.GetString(4),
                reader.IsDBNull(5) ? null : reader.GetString(5),
                reader.IsDBNull(6) ? null : reader.GetString(6),
                reader.IsDBNull(7) ? null : reader.GetString(7),
                reader.GetString(8),
                ParseEnum<Confidence>(reader.GetString(9)),
                reader.IsDBNull(10) ? null : reader.GetString(10),
                reader.IsDBNull(11) ? null : reader.GetString(11),
                reader.IsDBNull(12) ? null : reader.GetString(12)));
        }
        return results;
    }

    private static T ParseEnum<T>(string value) where T : struct, Enum =>
        Enum.TryParse<T>(value.Replace("_", "", StringComparison.Ordinal), true, out var result) ? result : default;

    private static string EnumName<T>(T value) where T : struct, Enum =>
        JsonNamingPolicy.SnakeCaseLower.ConvertName(value.ToString());

    private static void AddSegmentParameters(SqliteCommand command, DateTimeOffset start, DateTimeOffset end, ActivityInput input)
    {
        command.Parameters.AddWithValue("$start", ToDb(start));
        command.Parameters.AddWithValue("$end", ToDb(end));
        command.Parameters.AddWithValue("$kind", EnumName(input.Kind));
        command.Parameters.AddWithValue("$app", Db(input.App));
        command.Parameters.AddWithValue("$title", Db(Limit(input.Title, 512)));
        command.Parameters.AddWithValue("$domain", Db(Limit(input.Domain, 253)));
        command.Parameters.AddWithValue("$path", Db(Limit(input.Path, 2048)));
        command.Parameters.AddWithValue("$source", Limit(input.Source, 64)!);
        command.Parameters.AddWithValue("$confidence", EnumName(input.Confidence));
    }

    private static object Db(string? value) => value is null ? DBNull.Value : value;
    private static string? EmptyToNull(string? value) => string.IsNullOrWhiteSpace(value) ? null : value;
    private static string? Limit(string? value, int max) => value is null || value.Length <= max ? value : value[..max];
    private static string ToDb(DateTimeOffset value) => value.UtcDateTime.ToString("O");

    private string? GetSetting(string key)
    {
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT value FROM settings WHERE key = $key";
        command.Parameters.AddWithValue("$key", key);
        return command.ExecuteScalar() as string;
    }

    private bool GetBool(string key, bool fallback) => bool.TryParse(GetSetting(key), out var value) ? value : fallback;
    private int GetInt(string key, int fallback) => int.TryParse(GetSetting(key), out var value) ? value : fallback;

    private void SetDefault(string key, string value)
    {
        using var command = connection.CreateCommand();
        command.CommandText = "INSERT OR IGNORE INTO settings(key, value) VALUES ($key, $value)";
        command.Parameters.AddWithValue("$key", key);
        command.Parameters.AddWithValue("$value", value);
        command.ExecuteNonQuery();
    }

    private void SetSetting(string key, string value, SqliteTransaction? transaction = null)
    {
        using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = "INSERT INTO settings(key, value) VALUES ($key, $value) ON CONFLICT(key) DO UPDATE SET value=excluded.value";
        command.Parameters.AddWithValue("$key", key);
        command.Parameters.AddWithValue("$value", value);
        command.ExecuteNonQuery();
    }

    private void ExecuteRaw(string sql)
    {
        using var command = connection.CreateCommand();
        command.CommandText = sql;
        command.ExecuteNonQuery();
    }

    private void EnsureColumn(string table, string column, string definition)
    {
        using var check = connection.CreateCommand();
        check.CommandText = $"PRAGMA table_info({table})";
        using var reader = check.ExecuteReader();
        while (reader.Read()) if (string.Equals(reader.GetString(1), column, StringComparison.OrdinalIgnoreCase)) return;
        reader.Close();
        ExecuteRaw($"ALTER TABLE {table} ADD COLUMN {column} {definition}");
    }

    public void Dispose() => connection.Dispose();
}
