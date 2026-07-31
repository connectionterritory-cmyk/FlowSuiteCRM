begin;

-- ============================================================
-- CWG Academy core schema
-- Fase 1 local: contenido, quizzes, enrollments y progreso base.
-- No incluye importaciones PNC, uploaded_sources ni ai_generations.
-- ============================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'academy_publication_status') then
    create type public.academy_publication_status as enum ('draft', 'published', 'archived');
  end if;
  if not exists (select 1 from pg_type where typname = 'academy_session_status') then
    create type public.academy_session_status as enum ('in_progress', 'completed', 'abandoned', 'expired');
  end if;
  if not exists (select 1 from pg_type where typname = 'academy_enrollment_status') then
    create type public.academy_enrollment_status as enum ('invited', 'active', 'completed', 'suspended');
  end if;
  if not exists (select 1 from pg_type where typname = 'academy_question_status') then
    create type public.academy_question_status as enum ('active', 'inactive', 'archived');
  end if;
  if not exists (select 1 from pg_type where typname = 'academy_difficulty') then
    create type public.academy_difficulty as enum ('beginner', 'intermediate', 'advanced');
  end if;
  if not exists (select 1 from pg_type where typname = 'academy_question_type') then
    create type public.academy_question_type as enum ('single_choice', 'multiple_choice', 'true_false');
  end if;
end
$$;

-- Reusable unique keys for composite multitenant FKs.
create unique index if not exists usuarios_org_id_id_uidx
  on public.usuarios (org_id, id);

create table if not exists public.academy_courses (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  slug text not null,
  code text,
  title text not null,
  description text,
  status public.academy_publication_status not null default 'draft',
  difficulty public.academy_difficulty,
  estimated_minutes integer,
  sort_order integer not null default 0,
  published_at timestamptz,
  archived_at timestamptz,
  created_by uuid not null default auth.uid(),
  updated_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint academy_courses_org_fk
    foreign key (org_id) references public.organizations(id) on delete restrict,
  constraint academy_courses_created_by_fk
    foreign key (created_by) references public.usuarios(id) on delete restrict,
  constraint academy_courses_updated_by_fk
    foreign key (updated_by) references public.usuarios(id) on delete restrict,
  constraint academy_courses_org_id_id_unique unique (org_id, id),
  constraint academy_courses_org_slug_unique unique (org_id, slug),
  constraint academy_courses_org_code_unique unique (org_id, code),
  constraint academy_courses_estimated_minutes_check
    check (estimated_minutes is null or estimated_minutes > 0),
  constraint academy_courses_sort_order_check
    check (sort_order >= 0),
  constraint academy_courses_archived_after_published_check
    check (archived_at is null or published_at is null or archived_at >= published_at)
);

comment on table public.academy_courses is
  'Curso raíz de CWG Academy, siempre perteneciente a una organización en fase 1.';

create table if not exists public.academy_modules (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  course_id uuid not null,
  slug text not null,
  title text not null,
  description text,
  status public.academy_publication_status not null default 'draft',
  sort_order integer not null default 0,
  created_by uuid not null default auth.uid(),
  updated_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint academy_modules_org_course_fk
    foreign key (org_id, course_id) references public.academy_courses(org_id, id) on delete restrict,
  constraint academy_modules_created_by_fk
    foreign key (created_by) references public.usuarios(id) on delete restrict,
  constraint academy_modules_updated_by_fk
    foreign key (updated_by) references public.usuarios(id) on delete restrict,
  constraint academy_modules_org_id_id_unique unique (org_id, id),
  constraint academy_modules_org_course_id_id_unique unique (org_id, id, course_id),
  constraint academy_modules_course_slug_unique unique (course_id, slug),
  constraint academy_modules_course_sort_order_unique unique (course_id, sort_order),
  constraint academy_modules_sort_order_check
    check (sort_order >= 0)
);

comment on table public.academy_modules is
  'Agrupaciones ordenadas de contenido dentro de un curso.';

create table if not exists public.academy_lessons (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  course_id uuid not null,
  module_id uuid not null,
  slug text not null,
  title text not null,
  summary text,
  body_markdown text,
  video_url text,
  status public.academy_publication_status not null default 'draft',
  estimated_minutes integer,
  sort_order integer not null default 0,
  published_at timestamptz,
  archived_at timestamptz,
  created_by uuid not null default auth.uid(),
  updated_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint academy_lessons_org_course_fk
    foreign key (org_id, course_id) references public.academy_courses(org_id, id) on delete restrict,
  constraint academy_lessons_org_module_course_fk
    foreign key (org_id, module_id, course_id) references public.academy_modules(org_id, id, course_id) on delete restrict,
  constraint academy_lessons_created_by_fk
    foreign key (created_by) references public.usuarios(id) on delete restrict,
  constraint academy_lessons_updated_by_fk
    foreign key (updated_by) references public.usuarios(id) on delete restrict,
  constraint academy_lessons_org_id_id_unique unique (org_id, id),
  constraint academy_lessons_org_id_id_course_unique unique (org_id, id, course_id),
  constraint academy_lessons_module_slug_unique unique (module_id, slug),
  constraint academy_lessons_module_sort_order_unique unique (module_id, sort_order),
  constraint academy_lessons_estimated_minutes_check
    check (estimated_minutes is null or estimated_minutes > 0),
  constraint academy_lessons_sort_order_check
    check (sort_order >= 0),
  constraint academy_lessons_archived_after_published_check
    check (archived_at is null or published_at is null or archived_at >= published_at)
);

comment on table public.academy_lessons is
  'Lecciones publicables dentro de un módulo.';

create table if not exists public.academy_topics (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  course_id uuid not null,
  lesson_id uuid,
  slug text not null,
  title text not null,
  description text,
  difficulty public.academy_difficulty,
  status public.academy_publication_status not null default 'published',
  sort_order integer not null default 0,
  created_by uuid not null default auth.uid(),
  updated_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint academy_topics_org_course_fk
    foreign key (org_id, course_id) references public.academy_courses(org_id, id) on delete restrict,
  constraint academy_topics_org_lesson_course_fk
    foreign key (org_id, lesson_id, course_id) references public.academy_lessons(org_id, id, course_id) on delete restrict,
  constraint academy_topics_created_by_fk
    foreign key (created_by) references public.usuarios(id) on delete restrict,
  constraint academy_topics_updated_by_fk
    foreign key (updated_by) references public.usuarios(id) on delete restrict,
  constraint academy_topics_org_id_id_unique unique (org_id, id),
  constraint academy_topics_org_id_id_course_unique unique (org_id, id, course_id),
  constraint academy_topics_course_slug_unique unique (course_id, slug),
  constraint academy_topics_lesson_sort_order_unique unique (lesson_id, sort_order),
  constraint academy_topics_sort_order_check
    check (sort_order >= 0)
);

comment on table public.academy_topics is
  'Temas del curso; pueden existir sin lección asociada en fase 1.';

create table if not exists public.academy_enrollments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  course_id uuid not null,
  user_id uuid not null,
  status public.academy_enrollment_status not null default 'invited',
  role_in_course text not null default 'academy_student',
  invited_at timestamptz,
  activated_at timestamptz,
  completed_at timestamptz,
  suspended_at timestamptz,
  created_by uuid not null default auth.uid(),
  updated_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint academy_enrollments_org_course_fk
    foreign key (org_id, course_id) references public.academy_courses(org_id, id) on delete restrict,
  constraint academy_enrollments_org_user_membership_fk
    foreign key (org_id, user_id) references public.memberships(org_id, user_id) on delete restrict,
  constraint academy_enrollments_created_by_fk
    foreign key (created_by) references public.usuarios(id) on delete restrict,
  constraint academy_enrollments_updated_by_fk
    foreign key (updated_by) references public.usuarios(id) on delete restrict,
  constraint academy_enrollments_org_id_id_unique unique (org_id, id),
  constraint academy_enrollments_org_id_id_user_course_unique unique (org_id, id, user_id, course_id),
  constraint academy_enrollments_course_user_unique unique (course_id, user_id),
  constraint academy_enrollments_role_in_course_check
    check (role_in_course in ('academy_admin', 'academy_instructor', 'academy_student')),
  constraint academy_enrollments_status_dates_check
    check (
      (status <> 'active' or activated_at is not null)
      and (status <> 'completed' or completed_at is not null)
      and (status <> 'suspended' or suspended_at is not null)
    )
);

comment on table public.academy_enrollments is
  'Inscripciones por curso y usuario dentro de una organización.';

create table if not exists public.academy_questions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  course_id uuid not null,
  topic_id uuid not null,
  question_type public.academy_question_type not null,
  status public.academy_question_status not null default 'active',
  difficulty public.academy_difficulty not null,
  prompt text not null,
  explanation text,
  hint text,
  points numeric(6,2) not null default 1,
  sort_order integer not null default 0,
  created_by uuid not null default auth.uid(),
  updated_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint academy_questions_org_course_fk
    foreign key (org_id, course_id) references public.academy_courses(org_id, id) on delete restrict,
  constraint academy_questions_org_topic_course_fk
    foreign key (org_id, topic_id, course_id) references public.academy_topics(org_id, id, course_id) on delete restrict,
  constraint academy_questions_created_by_fk
    foreign key (created_by) references public.usuarios(id) on delete restrict,
  constraint academy_questions_updated_by_fk
    foreign key (updated_by) references public.usuarios(id) on delete restrict,
  constraint academy_questions_org_id_id_unique unique (org_id, id),
  constraint academy_questions_org_id_id_course_unique unique (org_id, id, course_id),
  constraint academy_questions_points_check
    check (points > 0),
  constraint academy_questions_sort_order_check
    check (sort_order >= 0)
);

comment on table public.academy_questions is
  'Banco reutilizable de preguntas por tema.';

create table if not exists public.academy_question_options (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  question_id uuid not null,
  option_key text not null,
  label text not null,
  sort_order integer not null default 0,
  is_correct boolean not null default false,
  explanation text,
  created_by uuid not null default auth.uid(),
  updated_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint academy_question_options_org_question_fk
    foreign key (org_id, question_id) references public.academy_questions(org_id, id) on delete restrict,
  constraint academy_question_options_created_by_fk
    foreign key (created_by) references public.usuarios(id) on delete restrict,
  constraint academy_question_options_updated_by_fk
    foreign key (updated_by) references public.usuarios(id) on delete restrict,
  constraint academy_question_options_org_id_id_unique unique (org_id, id),
  constraint academy_question_options_org_id_id_question_unique unique (org_id, id, question_id),
  constraint academy_question_options_question_option_key_unique unique (question_id, option_key),
  constraint academy_question_options_question_sort_order_unique unique (question_id, sort_order),
  constraint academy_question_options_sort_order_check
    check (sort_order >= 0)
);

comment on table public.academy_question_options is
  'Opciones de respuesta; is_correct nunca se expone a estudiantes.';

create table if not exists public.academy_quizzes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  course_id uuid not null,
  slug text not null,
  title text not null,
  description text,
  status public.academy_publication_status not null default 'draft',
  quiz_kind text not null default 'practice',
  randomize_questions boolean not null default false,
  randomize_options boolean not null default false,
  time_limit_minutes integer,
  max_attempts integer,
  passing_score numeric(5,2),
  show_results_after_submit boolean not null default true,
  show_explanations_after_submit boolean not null default false,
  sort_order integer not null default 0,
  created_by uuid not null default auth.uid(),
  updated_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint academy_quizzes_org_course_fk
    foreign key (org_id, course_id) references public.academy_courses(org_id, id) on delete restrict,
  constraint academy_quizzes_created_by_fk
    foreign key (created_by) references public.usuarios(id) on delete restrict,
  constraint academy_quizzes_updated_by_fk
    foreign key (updated_by) references public.usuarios(id) on delete restrict,
  constraint academy_quizzes_org_id_id_unique unique (org_id, id),
  constraint academy_quizzes_org_id_id_course_unique unique (org_id, id, course_id),
  constraint academy_quizzes_course_slug_unique unique (course_id, slug),
  constraint academy_quizzes_course_sort_order_unique unique (course_id, sort_order),
  constraint academy_quizzes_quiz_kind_check
    check (quiz_kind in ('practice', 'exam_simulation', 'assessment')),
  constraint academy_quizzes_time_limit_check
    check (time_limit_minutes is null or time_limit_minutes > 0),
  constraint academy_quizzes_max_attempts_check
    check (max_attempts is null or max_attempts > 0),
  constraint academy_quizzes_passing_score_check
    check (passing_score is null or (passing_score >= 0 and passing_score <= 100)),
  constraint academy_quizzes_sort_order_check
    check (sort_order >= 0)
);

comment on table public.academy_quizzes is
  'Simulacros y quizzes publicados por curso.';

create table if not exists public.academy_quiz_questions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  quiz_id uuid not null,
  course_id uuid not null,
  question_id uuid not null,
  sort_order integer not null,
  points_override numeric(6,2),
  is_required boolean not null default true,
  created_by uuid not null default auth.uid(),
  updated_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint academy_quiz_questions_org_quiz_course_fk
    foreign key (org_id, quiz_id, course_id) references public.academy_quizzes(org_id, id, course_id) on delete restrict,
  constraint academy_quiz_questions_org_question_course_fk
    foreign key (org_id, question_id, course_id) references public.academy_questions(org_id, id, course_id) on delete restrict,
  constraint academy_quiz_questions_created_by_fk
    foreign key (created_by) references public.usuarios(id) on delete restrict,
  constraint academy_quiz_questions_updated_by_fk
    foreign key (updated_by) references public.usuarios(id) on delete restrict,
  constraint academy_quiz_questions_org_id_id_unique unique (org_id, id),
  constraint academy_quiz_questions_quiz_question_unique unique (quiz_id, question_id),
  constraint academy_quiz_questions_quiz_sort_order_unique unique (quiz_id, sort_order),
  constraint academy_quiz_questions_points_override_check
    check (points_override is null or points_override > 0),
  constraint academy_quiz_questions_sort_order_check
    check (sort_order >= 0)
);

comment on table public.academy_quiz_questions is
  'Selección ordenada de preguntas dentro de un quiz.';

create table if not exists public.academy_quiz_sessions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  course_id uuid not null,
  quiz_id uuid not null,
  user_id uuid not null,
  enrollment_id uuid not null,
  attempt_number integer not null,
  status public.academy_session_status not null default 'in_progress',
  started_at timestamptz not null default now(),
  expires_at timestamptz,
  completed_at timestamptz,
  abandoned_at timestamptz,
  score_percent numeric(5,2),
  correct_count integer,
  incorrect_count integer,
  unanswered_count integer,
  passed boolean,
  last_activity_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint academy_quiz_sessions_org_quiz_course_fk
    foreign key (org_id, quiz_id, course_id) references public.academy_quizzes(org_id, id, course_id) on delete restrict,
  constraint academy_quiz_sessions_org_enrollment_fk
    foreign key (org_id, enrollment_id, user_id, course_id)
    references public.academy_enrollments(org_id, id, user_id, course_id) on delete restrict,
  constraint academy_quiz_sessions_org_user_membership_fk
    foreign key (org_id, user_id) references public.memberships(org_id, user_id) on delete restrict,
  constraint academy_quiz_sessions_org_id_id_unique unique (org_id, id),
  constraint academy_quiz_sessions_quiz_user_attempt_unique unique (quiz_id, user_id, attempt_number),
  constraint academy_quiz_sessions_attempt_number_check
    check (attempt_number > 0),
  constraint academy_quiz_sessions_score_percent_check
    check (score_percent is null or (score_percent >= 0 and score_percent <= 100)),
  constraint academy_quiz_sessions_counts_nonnegative_check
    check (
      (correct_count is null or correct_count >= 0)
      and (incorrect_count is null or incorrect_count >= 0)
      and (unanswered_count is null or unanswered_count >= 0)
    ),
  constraint academy_quiz_sessions_completed_status_check
    check (
      (status <> 'completed' or completed_at is not null)
      and (status <> 'abandoned' or abandoned_at is not null)
      and (status <> 'expired' or expires_at is not null)
    )
);

comment on table public.academy_quiz_sessions is
  'Intentos de quiz por usuario; historial preservado sin soft delete.';

create table if not exists public.academy_quiz_answers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  session_id uuid not null,
  course_id uuid not null,
  quiz_id uuid not null,
  question_id uuid not null,
  selected_option_id uuid,
  boolean_answer boolean,
  is_correct boolean,
  points_awarded numeric(6,2),
  answered_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint academy_quiz_answers_org_session_fk
    foreign key (org_id, session_id) references public.academy_quiz_sessions(org_id, id) on delete restrict,
  constraint academy_quiz_answers_org_quiz_course_fk
    foreign key (org_id, quiz_id, course_id) references public.academy_quizzes(org_id, id, course_id) on delete restrict,
  constraint academy_quiz_answers_org_question_course_fk
    foreign key (org_id, question_id, course_id) references public.academy_questions(org_id, id, course_id) on delete restrict,
  constraint academy_quiz_answers_org_option_fk
    foreign key (org_id, selected_option_id, question_id)
    references public.academy_question_options(org_id, id, question_id) on delete restrict,
  constraint academy_quiz_answers_org_id_id_unique unique (org_id, id),
  constraint academy_quiz_answers_org_id_id_question_unique unique (org_id, id, question_id),
  constraint academy_quiz_answers_session_question_unique unique (session_id, question_id),
  constraint academy_quiz_answers_points_awarded_check
    check (points_awarded is null or points_awarded >= 0)
);

comment on table public.academy_quiz_answers is
  'Respuesta base por pregunta; single_choice y true_false viven aquí.';

create table if not exists public.academy_quiz_answer_options (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  answer_id uuid not null,
  question_id uuid not null,
  option_id uuid not null,
  created_at timestamptz not null default now(),
  constraint academy_quiz_answer_options_org_answer_fk
    foreign key (org_id, answer_id, question_id)
    references public.academy_quiz_answers(org_id, id, question_id) on delete restrict,
  constraint academy_quiz_answer_options_org_option_fk
    foreign key (org_id, option_id, question_id)
    references public.academy_question_options(org_id, id, question_id) on delete restrict,
  constraint academy_quiz_answer_options_org_id_id_unique unique (org_id, id),
  constraint academy_quiz_answer_options_answer_option_unique unique (answer_id, option_id)
);

comment on table public.academy_quiz_answer_options is
  'Selecciones múltiples por respuesta; evita uuid[] y conserva integridad.';

create table if not exists public.academy_flashcards (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  course_id uuid not null,
  topic_id uuid not null,
  front_text text not null,
  back_text text not null,
  status public.academy_publication_status not null default 'published',
  sort_order integer not null default 0,
  created_by uuid not null default auth.uid(),
  updated_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint academy_flashcards_org_course_fk
    foreign key (org_id, course_id) references public.academy_courses(org_id, id) on delete restrict,
  constraint academy_flashcards_org_topic_course_fk
    foreign key (org_id, topic_id, course_id) references public.academy_topics(org_id, id, course_id) on delete restrict,
  constraint academy_flashcards_created_by_fk
    foreign key (created_by) references public.usuarios(id) on delete restrict,
  constraint academy_flashcards_updated_by_fk
    foreign key (updated_by) references public.usuarios(id) on delete restrict,
  constraint academy_flashcards_org_id_id_unique unique (org_id, id),
  constraint academy_flashcards_topic_sort_order_unique unique (topic_id, sort_order),
  constraint academy_flashcards_sort_order_check
    check (sort_order >= 0)
);

comment on table public.academy_flashcards is
  'Tarjetas de estudio por tema.';

create table if not exists public.academy_study_plans (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  course_id uuid not null,
  title text not null,
  description text,
  status public.academy_publication_status not null default 'draft',
  target_days integer,
  created_by uuid not null default auth.uid(),
  updated_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint academy_study_plans_org_course_fk
    foreign key (org_id, course_id) references public.academy_courses(org_id, id) on delete restrict,
  constraint academy_study_plans_created_by_fk
    foreign key (created_by) references public.usuarios(id) on delete restrict,
  constraint academy_study_plans_updated_by_fk
    foreign key (updated_by) references public.usuarios(id) on delete restrict,
  constraint academy_study_plans_org_id_id_unique unique (org_id, id),
  constraint academy_study_plans_org_course_title_unique unique (org_id, course_id, title),
  constraint academy_study_plans_target_days_check
    check (target_days is null or target_days > 0)
);

comment on table public.academy_study_plans is
  'Planes de estudio reutilizables por curso.';

create table if not exists public.academy_study_plan_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  study_plan_id uuid not null,
  lesson_id uuid,
  topic_id uuid,
  quiz_id uuid,
  day_number integer not null,
  sort_order integer not null default 0,
  recommended_minutes integer,
  notes text,
  created_by uuid not null default auth.uid(),
  updated_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint academy_study_plan_items_org_plan_fk
    foreign key (org_id, study_plan_id) references public.academy_study_plans(org_id, id) on delete cascade,
  constraint academy_study_plan_items_org_lesson_fk
    foreign key (org_id, lesson_id) references public.academy_lessons(org_id, id) on delete restrict,
  constraint academy_study_plan_items_org_topic_fk
    foreign key (org_id, topic_id) references public.academy_topics(org_id, id) on delete restrict,
  constraint academy_study_plan_items_org_quiz_fk
    foreign key (org_id, quiz_id) references public.academy_quizzes(org_id, id) on delete restrict,
  constraint academy_study_plan_items_created_by_fk
    foreign key (created_by) references public.usuarios(id) on delete restrict,
  constraint academy_study_plan_items_updated_by_fk
    foreign key (updated_by) references public.usuarios(id) on delete restrict,
  constraint academy_study_plan_items_org_id_id_unique unique (org_id, id),
  constraint academy_study_plan_items_plan_day_sort_unique unique (study_plan_id, day_number, sort_order),
  constraint academy_study_plan_items_target_presence_check
    check ((lesson_id is not null)::int + (topic_id is not null)::int + (quiz_id is not null)::int >= 1),
  constraint academy_study_plan_items_day_number_check
    check (day_number > 0),
  constraint academy_study_plan_items_sort_order_check
    check (sort_order >= 0),
  constraint academy_study_plan_items_recommended_minutes_check
    check (recommended_minutes is null or recommended_minutes > 0)
);

comment on table public.academy_study_plan_items is
  'Pasos ordenados del plan de estudio.';

create table if not exists public.academy_user_progress (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  course_id uuid not null,
  user_id uuid not null,
  enrollment_id uuid not null,
  lesson_id uuid,
  topic_id uuid,
  completed_at timestamptz,
  mastery_percent numeric(5,2),
  correct_count integer not null default 0,
  incorrect_count integer not null default 0,
  last_activity_at timestamptz not null default now(),
  streak_days integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint academy_user_progress_org_course_fk
    foreign key (org_id, course_id) references public.academy_courses(org_id, id) on delete restrict,
  constraint academy_user_progress_org_enrollment_fk
    foreign key (org_id, enrollment_id, user_id, course_id)
    references public.academy_enrollments(org_id, id, user_id, course_id) on delete restrict,
  constraint academy_user_progress_org_user_membership_fk
    foreign key (org_id, user_id) references public.memberships(org_id, user_id) on delete restrict,
  constraint academy_user_progress_org_lesson_fk
    foreign key (org_id, lesson_id) references public.academy_lessons(org_id, id) on delete restrict,
  constraint academy_user_progress_org_topic_fk
    foreign key (org_id, topic_id) references public.academy_topics(org_id, id) on delete restrict,
  constraint academy_user_progress_org_id_id_unique unique (org_id, id),
  constraint academy_user_progress_target_presence_check
    check (lesson_id is not null or topic_id is not null),
  constraint academy_user_progress_mastery_percent_check
    check (mastery_percent is null or (mastery_percent >= 0 and mastery_percent <= 100)),
  constraint academy_user_progress_counts_check
    check (correct_count >= 0 and incorrect_count >= 0 and streak_days >= 0)
);

create unique index if not exists academy_user_progress_user_course_lesson_uidx
  on public.academy_user_progress (user_id, course_id, lesson_id)
  where lesson_id is not null;

create unique index if not exists academy_user_progress_user_course_topic_uidx
  on public.academy_user_progress (user_id, course_id, topic_id)
  where topic_id is not null;

comment on table public.academy_user_progress is
  'Progreso fuente por usuario; evita almacenar agregados globales inconsistentes.';

create table if not exists public.academy_user_settings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  course_id uuid not null,
  user_id uuid not null,
  enrollment_id uuid not null,
  preferred_study_minutes integer,
  preferred_quiz_mode text,
  flashcard_order text,
  email_reminders_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint academy_user_settings_org_course_fk
    foreign key (org_id, course_id) references public.academy_courses(org_id, id) on delete restrict,
  constraint academy_user_settings_org_enrollment_fk
    foreign key (org_id, enrollment_id, user_id, course_id)
    references public.academy_enrollments(org_id, id, user_id, course_id) on delete restrict,
  constraint academy_user_settings_org_user_membership_fk
    foreign key (org_id, user_id) references public.memberships(org_id, user_id) on delete restrict,
  constraint academy_user_settings_org_id_id_unique unique (org_id, id),
  constraint academy_user_settings_user_course_unique unique (user_id, course_id),
  constraint academy_user_settings_preferred_study_minutes_check
    check (preferred_study_minutes is null or preferred_study_minutes > 0),
  constraint academy_user_settings_preferred_quiz_mode_check
    check (preferred_quiz_mode is null or preferred_quiz_mode in ('practice', 'timed', 'review')),
  constraint academy_user_settings_flashcard_order_check
    check (flashcard_order is null or flashcard_order in ('default', 'random'))
);

comment on table public.academy_user_settings is
  'Preferencias privadas por usuario y curso.';

-- Indexes for frequent org and FK filters.
create index if not exists academy_courses_org_status_idx
  on public.academy_courses (org_id, status, sort_order);
create index if not exists academy_modules_org_course_status_idx
  on public.academy_modules (org_id, course_id, status, sort_order);
create index if not exists academy_lessons_org_module_status_idx
  on public.academy_lessons (org_id, module_id, status, sort_order);
create index if not exists academy_topics_org_course_lesson_idx
  on public.academy_topics (org_id, course_id, lesson_id, status, sort_order);
create index if not exists academy_enrollments_org_user_status_idx
  on public.academy_enrollments (org_id, user_id, status);
create index if not exists academy_enrollments_org_course_status_idx
  on public.academy_enrollments (org_id, course_id, status);
create index if not exists academy_questions_org_topic_status_idx
  on public.academy_questions (org_id, topic_id, status, difficulty);
create index if not exists academy_question_options_org_question_idx
  on public.academy_question_options (org_id, question_id, sort_order);
create index if not exists academy_quizzes_org_course_status_idx
  on public.academy_quizzes (org_id, course_id, status, sort_order);
create index if not exists academy_quiz_questions_org_quiz_idx
  on public.academy_quiz_questions (org_id, quiz_id, sort_order);
create index if not exists academy_quiz_sessions_org_user_status_idx
  on public.academy_quiz_sessions (org_id, user_id, status, started_at desc);
create index if not exists academy_quiz_sessions_org_quiz_user_idx
  on public.academy_quiz_sessions (org_id, quiz_id, user_id);
create index if not exists academy_quiz_answers_org_session_idx
  on public.academy_quiz_answers (org_id, session_id);
create index if not exists academy_quiz_answers_org_question_idx
  on public.academy_quiz_answers (org_id, question_id);
create index if not exists academy_quiz_answer_options_org_answer_idx
  on public.academy_quiz_answer_options (org_id, answer_id);
create index if not exists academy_flashcards_org_topic_status_idx
  on public.academy_flashcards (org_id, topic_id, status, sort_order);
create index if not exists academy_study_plans_org_course_status_idx
  on public.academy_study_plans (org_id, course_id, status);
create index if not exists academy_study_plan_items_org_plan_day_idx
  on public.academy_study_plan_items (org_id, study_plan_id, day_number, sort_order);
create index if not exists academy_user_progress_org_user_idx
  on public.academy_user_progress (org_id, user_id, course_id, last_activity_at desc);
create index if not exists academy_user_settings_org_user_idx
  on public.academy_user_settings (org_id, user_id, course_id);

-- updated_at triggers only on mutable content/config tables.
drop trigger if exists trg_academy_courses_updated_at on public.academy_courses;
create trigger trg_academy_courses_updated_at
  before update on public.academy_courses
  for each row execute function public.fn_set_updated_at();

drop trigger if exists trg_academy_modules_updated_at on public.academy_modules;
create trigger trg_academy_modules_updated_at
  before update on public.academy_modules
  for each row execute function public.fn_set_updated_at();

drop trigger if exists trg_academy_lessons_updated_at on public.academy_lessons;
create trigger trg_academy_lessons_updated_at
  before update on public.academy_lessons
  for each row execute function public.fn_set_updated_at();

drop trigger if exists trg_academy_topics_updated_at on public.academy_topics;
create trigger trg_academy_topics_updated_at
  before update on public.academy_topics
  for each row execute function public.fn_set_updated_at();

drop trigger if exists trg_academy_enrollments_updated_at on public.academy_enrollments;
create trigger trg_academy_enrollments_updated_at
  before update on public.academy_enrollments
  for each row execute function public.fn_set_updated_at();

drop trigger if exists trg_academy_questions_updated_at on public.academy_questions;
create trigger trg_academy_questions_updated_at
  before update on public.academy_questions
  for each row execute function public.fn_set_updated_at();

drop trigger if exists trg_academy_question_options_updated_at on public.academy_question_options;
create trigger trg_academy_question_options_updated_at
  before update on public.academy_question_options
  for each row execute function public.fn_set_updated_at();

drop trigger if exists trg_academy_quizzes_updated_at on public.academy_quizzes;
create trigger trg_academy_quizzes_updated_at
  before update on public.academy_quizzes
  for each row execute function public.fn_set_updated_at();

drop trigger if exists trg_academy_quiz_questions_updated_at on public.academy_quiz_questions;
create trigger trg_academy_quiz_questions_updated_at
  before update on public.academy_quiz_questions
  for each row execute function public.fn_set_updated_at();

drop trigger if exists trg_academy_quiz_sessions_updated_at on public.academy_quiz_sessions;
create trigger trg_academy_quiz_sessions_updated_at
  before update on public.academy_quiz_sessions
  for each row execute function public.fn_set_updated_at();

drop trigger if exists trg_academy_quiz_answers_updated_at on public.academy_quiz_answers;
create trigger trg_academy_quiz_answers_updated_at
  before update on public.academy_quiz_answers
  for each row execute function public.fn_set_updated_at();

drop trigger if exists trg_academy_flashcards_updated_at on public.academy_flashcards;
create trigger trg_academy_flashcards_updated_at
  before update on public.academy_flashcards
  for each row execute function public.fn_set_updated_at();

drop trigger if exists trg_academy_study_plans_updated_at on public.academy_study_plans;
create trigger trg_academy_study_plans_updated_at
  before update on public.academy_study_plans
  for each row execute function public.fn_set_updated_at();

drop trigger if exists trg_academy_study_plan_items_updated_at on public.academy_study_plan_items;
create trigger trg_academy_study_plan_items_updated_at
  before update on public.academy_study_plan_items
  for each row execute function public.fn_set_updated_at();

drop trigger if exists trg_academy_user_progress_updated_at on public.academy_user_progress;
create trigger trg_academy_user_progress_updated_at
  before update on public.academy_user_progress
  for each row execute function public.fn_set_updated_at();

drop trigger if exists trg_academy_user_settings_updated_at on public.academy_user_settings;
create trigger trg_academy_user_settings_updated_at
  before update on public.academy_user_settings
  for each row execute function public.fn_set_updated_at();

commit;
