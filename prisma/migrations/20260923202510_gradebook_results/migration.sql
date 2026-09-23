-- CreateEnum
CREATE TYPE "RuleSetStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- CreateTable
CREATE TABLE "averaging_rule_sets" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "academic_year_id" UUID,
    "definition" JSONB NOT NULL,
    "status" "RuleSetStatus" NOT NULL DEFAULT 'DRAFT',
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activated_at" TIMESTAMPTZ(3),

    CONSTRAINT "averaging_rule_sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "module_result_snapshots" (
    "id" UUID NOT NULL,
    "module_id" UUID NOT NULL,
    "class_section_id" UUID NOT NULL,
    "rule_set_id" UUID,
    "data" JSONB NOT NULL,
    "computed_by_id" UUID,
    "computed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "module_result_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "averaging_rule_sets_name_version_key" ON "averaging_rule_sets"("name", "version");

-- CreateIndex
CREATE UNIQUE INDEX "module_result_snapshots_module_id_class_section_id_key" ON "module_result_snapshots"("module_id", "class_section_id");

-- AddForeignKey
ALTER TABLE "averaging_rule_sets" ADD CONSTRAINT "averaging_rule_sets_academic_year_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "academic_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "averaging_rule_sets" ADD CONSTRAINT "averaging_rule_sets_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "module_result_snapshots" ADD CONSTRAINT "module_result_snapshots_module_id_fkey" FOREIGN KEY ("module_id") REFERENCES "modules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "module_result_snapshots" ADD CONSTRAINT "module_result_snapshots_class_section_id_fkey" FOREIGN KEY ("class_section_id") REFERENCES "class_sections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "module_result_snapshots" ADD CONSTRAINT "module_result_snapshots_rule_set_id_fkey" FOREIGN KEY ("rule_set_id") REFERENCES "averaging_rule_sets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "module_result_snapshots" ADD CONSTRAINT "module_result_snapshots_computed_by_id_fkey" FOREIGN KEY ("computed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- History protection for results.
CREATE TRIGGER "averaging_rule_sets_no_delete" BEFORE DELETE ON "averaging_rule_sets" FOR EACH ROW EXECUTE FUNCTION forbid_modification();
CREATE TRIGGER "averaging_rule_sets_no_truncate" BEFORE TRUNCATE ON "averaging_rule_sets" FOR EACH STATEMENT EXECUTE FUNCTION forbid_modification();
CREATE TRIGGER "module_result_snapshots_immutable" BEFORE UPDATE OR DELETE ON "module_result_snapshots" FOR EACH ROW EXECUTE FUNCTION forbid_modification();
CREATE TRIGGER "module_result_snapshots_no_truncate" BEFORE TRUNCATE ON "module_result_snapshots" FOR EACH STATEMENT EXECUTE FUNCTION forbid_modification();

-- An activated rule set is frozen: only its status may change afterwards (ACTIVE → ARCHIVED).
CREATE FUNCTION "averaging_rule_sets_freeze"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'DRAFT' AND (NEW.definition IS DISTINCT FROM OLD.definition OR NEW.name <> OLD.name OR NEW.version <> OLD.version) THEN
    RAISE EXCEPTION 'Un set de reguli activat nu mai poate fi modificat; creați o versiune nouă.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "averaging_rule_sets_freeze" BEFORE UPDATE ON "averaging_rule_sets" FOR EACH ROW EXECUTE FUNCTION averaging_rule_sets_freeze();

-- A module-subject link cannot be removed once grades exist for it.
CREATE FUNCTION "module_subjects_protect_graded"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM grades WHERE module_id = OLD.module_id AND subject_id = OLD.subject_id) THEN
    RAISE EXCEPTION 'Materia are deja note în acest modul și nu poate fi eliminată din modul.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER "module_subjects_protect_graded" BEFORE DELETE ON "module_subjects" FOR EACH ROW EXECUTE FUNCTION module_subjects_protect_graded();

-- Snapshots are append-only for the app role as well.
