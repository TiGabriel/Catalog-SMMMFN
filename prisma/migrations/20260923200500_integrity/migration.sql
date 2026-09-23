-- Integrity rules that Prisma cannot express in schema.prisma.
-- Implemented with CHECK constraints and triggers (not partial indexes) so
-- that `prisma migrate diff` never proposes to drop them.

-- ───────────── CHECK constraints ─────────────
ALTER TABLE "grades" ADD CONSTRAINT "grades_value_range" CHECK ("value" >= 1 AND "value" <= 10);
ALTER TABLE "grade_revisions" ADD CONSTRAINT "grade_revisions_value_range" CHECK ("value" >= 1 AND "value" <= 10);
ALTER TABLE "grade_correction_requests" ADD CONSTRAINT "gcr_proposed_value_range"
  CHECK ("proposed_value" IS NULL OR ("proposed_value" >= 1 AND "proposed_value" <= 10));
ALTER TABLE "grade_correction_requests" ADD CONSTRAINT "gcr_justification_not_blank" CHECK (length(btrim("justification")) > 0);
ALTER TABLE "grades" ADD CONSTRAINT "grades_deleted_has_reason"
  CHECK ("status" <> 'DELETED' OR ("deleted_at" IS NOT NULL AND "deleted_by_id" IS NOT NULL AND length(btrim(coalesce("deletion_reason", ''))) > 0));

ALTER TABLE "class_sections" ADD CONSTRAINT "class_sections_year_of_study" CHECK ("year_of_study" IN (1, 2));
ALTER TABLE "class_sections" ADD CONSTRAINT "class_sections_code_format" CHECK ("code" ~ '^[1-9][0-9]{2}$');
ALTER TABLE "modules" ADD CONSTRAINT "modules_year_of_study" CHECK ("year_of_study" IN (1, 2));
ALTER TABLE "companies" ADD CONSTRAINT "companies_year_of_study" CHECK ("year_of_study" IN (1, 2));
ALTER TABLE "academic_years" ADD CONSTRAINT "academic_years_dates" CHECK ("end_date" > "start_date");
ALTER TABLE "teaching_assignments" ADD CONSTRAINT "teaching_assignments_dates" CHECK ("valid_to" IS NULL OR "valid_to" >= "valid_from");
ALTER TABLE "teaching_assignments" ADD CONSTRAINT "teaching_assignments_exam_module"
  CHECK ("kind" <> 'MODULE_EXAM' OR "module_id" IS NOT NULL);
ALTER TABLE "homeroom_assignments" ADD CONSTRAINT "homeroom_assignments_dates" CHECK ("valid_to" IS NULL OR "valid_to" >= "valid_from");
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_dates" CHECK ("end_date" IS NULL OR "end_date" >= "start_date");
ALTER TABLE "timetable_entries" ADD CONSTRAINT "timetable_entries_day" CHECK ("day_of_week" BETWEEN 1 AND 7);
ALTER TABLE "time_slots" ADD CONSTRAINT "time_slots_format"
  CHECK ("start_time" ~ '^[0-2][0-9]:[0-5][0-9]$' AND "end_time" ~ '^[0-2][0-9]:[0-5][0-9]$' AND "end_time" > "start_time");
ALTER TABLE "users" ADD CONSTRAINT "users_username_lowercase" CHECK ("username" = lower("username"));
ALTER TABLE "users" ADD CONSTRAINT "users_deleted_has_no_password" CHECK ("status" <> 'DELETED' OR "password_hash" IS NULL);

-- ───────────── Generic guards ─────────────
CREATE FUNCTION "forbid_modification"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Operația % pe tabela % este interzisă (date istorice protejate).', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END $$;

-- Historical tables: rows may never be physically deleted or truncated.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'users', 'students', 'enrollments', 'academic_years', 'companies', 'cohorts', 'class_sections',
    'subjects', 'modules', 'teaching_assignments', 'homeroom_assignments', 'grades', 'grade_reasons',
    'grade_correction_requests', 'year_rollovers', 'timetable_versions', 'timetable_imports', 'ranks'
  ] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE DELETE ON %I FOR EACH ROW EXECUTE FUNCTION forbid_modification()', t || '_no_delete', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION forbid_modification()', t || '_no_truncate', t);
  END LOOP;
END $$;

-- Grade revisions are fully immutable.
CREATE TRIGGER "grade_revisions_immutable" BEFORE UPDATE OR DELETE ON "grade_revisions"
  FOR EACH ROW EXECUTE FUNCTION forbid_modification();
CREATE TRIGGER "grade_revisions_no_truncate" BEFORE TRUNCATE ON "grade_revisions"
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_modification();

-- A grade keeps its original author forever and cannot be moved to another student/class/subject.
CREATE FUNCTION "grades_protect_identity"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.author_id <> OLD.author_id OR NEW.student_id <> OLD.student_id OR NEW.class_section_id <> OLD.class_section_id
     OR NEW.subject_id <> OLD.subject_id OR NEW.academic_year_id <> OLD.academic_year_id OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'Autorul, elevul, clasa, materia și anul unei note nu pot fi modificate.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "grades_protect_identity" BEFORE UPDATE ON "grades"
  FOR EACH ROW EXECUTE FUNCTION grades_protect_identity();

-- ───────────── Single-row invariants ─────────────
CREATE FUNCTION "academic_years_single_active"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'ACTIVE' THEN
    PERFORM pg_advisory_xact_lock(hashtext('academic_years_single_active'));
    IF EXISTS (SELECT 1 FROM academic_years WHERE status = 'ACTIVE' AND id <> NEW.id) THEN
      RAISE EXCEPTION 'Poate exista un singur an școlar activ.' USING ERRCODE = 'unique_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "academic_years_single_active" BEFORE INSERT OR UPDATE OF status ON "academic_years"
  FOR EACH ROW EXECUTE FUNCTION academic_years_single_active();

CREATE FUNCTION "enrollments_single_active"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'ACTIVE' THEN
    PERFORM pg_advisory_xact_lock(hashtext('enrollments_single_active:' || NEW.student_id::text));
    IF EXISTS (SELECT 1 FROM enrollments WHERE status = 'ACTIVE' AND student_id = NEW.student_id
               AND academic_year_id = NEW.academic_year_id AND id <> NEW.id) THEN
      RAISE EXCEPTION 'Elevul are deja o înmatriculare activă în acest an școlar.' USING ERRCODE = 'unique_violation';
    END IF;
  END IF;
  -- The class must belong to the same academic year as the enrollment.
  IF NOT EXISTS (SELECT 1 FROM class_sections WHERE id = NEW.class_section_id AND academic_year_id = NEW.academic_year_id) THEN
    RAISE EXCEPTION 'Clasa nu aparține anului școlar al înmatriculării.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "enrollments_single_active" BEFORE INSERT OR UPDATE ON "enrollments"
  FOR EACH ROW EXECUTE FUNCTION enrollments_single_active();

CREATE FUNCTION "homeroom_single_active"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.ended_at IS NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('homeroom_single_active:' || NEW.class_section_id::text));
    IF EXISTS (SELECT 1 FROM homeroom_assignments WHERE class_section_id = NEW.class_section_id
               AND ended_at IS NULL AND id <> NEW.id) THEN
      RAISE EXCEPTION 'Clasa are deja un diriginte activ.' USING ERRCODE = 'unique_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "homeroom_single_active" BEFORE INSERT OR UPDATE ON "homeroom_assignments"
  FOR EACH ROW EXECUTE FUNCTION homeroom_single_active();

-- Assignments must reference a class of the same academic year.
CREATE FUNCTION "assignment_year_matches_class"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM class_sections WHERE id = NEW.class_section_id AND academic_year_id = NEW.academic_year_id) THEN
    RAISE EXCEPTION 'Clasa nu aparține anului școlar al repartizării.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "teaching_assignments_year" BEFORE INSERT OR UPDATE ON "teaching_assignments"
  FOR EACH ROW EXECUTE FUNCTION assignment_year_matches_class();
CREATE TRIGGER "homeroom_assignments_year" BEFORE INSERT OR UPDATE ON "homeroom_assignments"
  FOR EACH ROW EXECUTE FUNCTION assignment_year_matches_class();

-- ───────────── Append-only, hash-chained audit log ─────────────
CREATE FUNCTION "audit_log_row_digest"(prev text, r "audit_log") RETURNS text LANGUAGE sql STABLE AS $$
  SELECT encode(sha256(convert_to(
    coalesce(prev, '') || '|' || r.id::text || '|' ||
    to_char(r.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') || '|' ||
    coalesce(r.actor_id::text, '') || '|' || coalesce(r.actor_snapshot::text, '') || '|' ||
    r.action || '|' || r.outcome::text || '|' ||
    coalesce(r.entity_type, '') || '|' || coalesce(r.entity_id, '') || '|' ||
    coalesce(r.student_id::text, '') || '|' || coalesce(r.class_section_id::text, '') || '|' ||
    coalesce(r.subject_id::text, '') || '|' || coalesce(r.academic_year_id::text, '') || '|' ||
    coalesce(r.before::text, '') || '|' || coalesce(r.after::text, '') || '|' ||
    coalesce(r.reason, '') || '|' || coalesce(r.metadata::text, '') || '|' ||
    coalesce(r.ip, '') || '|' || coalesce(r.user_agent, '') || '|' ||
    coalesce(r.session_ref, '') || '|' || coalesce(r.request_id, ''),
  'UTF8')), 'hex')
$$;

CREATE FUNCTION "audit_log_before_insert"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE last_hash text;
BEGIN
  -- Serialize audit writers so ids, timestamps and the hash chain are strictly ordered.
  PERFORM pg_advisory_xact_lock(hashtext('audit_log_chain'));
  NEW.id := nextval(pg_get_serial_sequence('audit_log', 'id'));
  NEW.occurred_at := clock_timestamp();   -- the application cannot back-date entries
  SELECT hash INTO last_hash FROM audit_log ORDER BY id DESC LIMIT 1;
  NEW.prev_hash := last_hash;
  NEW.hash := audit_log_row_digest(last_hash, NEW);
  RETURN NEW;
END $$;
CREATE TRIGGER "audit_log_before_insert" BEFORE INSERT ON "audit_log"
  FOR EACH ROW EXECUTE FUNCTION audit_log_before_insert();
CREATE TRIGGER "audit_log_immutable" BEFORE UPDATE OR DELETE ON "audit_log"
  FOR EACH ROW EXECUTE FUNCTION forbid_modification();
CREATE TRIGGER "audit_log_no_truncate" BEFORE TRUNCATE ON "audit_log"
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_modification();

-- Returns the id of the first entry whose chain link or hash does not verify (NULL = intact).
CREATE FUNCTION "audit_log_verify_chain"() RETURNS TABLE (checked bigint, first_invalid_id bigint) LANGUAGE plpgsql STABLE AS $$
DECLARE
  r audit_log;
  expected_prev text := NULL;
  n bigint := 0;
BEGIN
  FOR r IN SELECT * FROM audit_log ORDER BY id LOOP
    n := n + 1;
    IF r.prev_hash IS DISTINCT FROM expected_prev OR r.hash <> audit_log_row_digest(r.prev_hash, r) THEN
      checked := n; first_invalid_id := r.id; RETURN NEXT; RETURN;
    END IF;
    expected_prev := r.hash;
  END LOOP;
  checked := n; first_invalid_id := NULL; RETURN NEXT;
END $$;
