-- CreateIndex
CREATE INDEX "audit_log_student_id_idx" ON "audit_log"("student_id");

-- CreateIndex
CREATE INDEX "audit_log_class_section_id_idx" ON "audit_log"("class_section_id");

-- CreateIndex
CREATE INDEX "enrollments_academic_year_id_status_idx" ON "enrollments"("academic_year_id", "status");

-- CreateIndex
CREATE INDEX "grade_correction_requests_grade_id_idx" ON "grade_correction_requests"("grade_id");

-- CreateIndex
CREATE INDEX "grade_correction_requests_requested_by_id_status_idx" ON "grade_correction_requests"("requested_by_id", "status");

-- CreateIndex
CREATE INDEX "grades_class_section_id_module_id_status_idx" ON "grades"("class_section_id", "module_id", "status");

-- CreateIndex
CREATE INDEX "grades_module_id_subject_id_idx" ON "grades"("module_id", "subject_id");

-- CreateIndex
CREATE INDEX "grades_academic_year_id_created_at_idx" ON "grades"("academic_year_id", "created_at");

-- CreateIndex
CREATE INDEX "homeroom_assignments_academic_year_id_idx" ON "homeroom_assignments"("academic_year_id");

-- CreateIndex
CREATE INDEX "teaching_assignments_academic_year_id_ended_at_idx" ON "teaching_assignments"("academic_year_id", "ended_at");

-- CreateIndex
CREATE INDEX "teaching_assignments_subject_id_idx" ON "teaching_assignments"("subject_id");
