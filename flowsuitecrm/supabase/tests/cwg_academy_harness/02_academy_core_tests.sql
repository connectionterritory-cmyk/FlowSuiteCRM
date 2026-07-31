\set ON_ERROR_STOP on

begin;

create or replace function public.test_assert(condition boolean, message text)
returns void
language plpgsql
as $$
begin
  if not condition then
    raise exception '%', message;
  end if;
end;
$$;

create or replace function public.test_expect_error(sql_text text, expected_state text, label text)
returns void
language plpgsql
as $$
declare
  got_state text;
begin
  begin
    execute sql_text;
    raise exception 'Expected error for %, but statement succeeded', label;
  exception
    when others then
      get stacked diagnostics got_state = returned_sqlstate;
      if got_state = 'P0001' and sqlerrm like 'Expected error for %' then
        raise;
      end if;
      if got_state <> expected_state then
        raise exception 'Unexpected SQLSTATE for %: expected %, got % (%).', label, expected_state, got_state, sqlerrm;
      end if;
  end;
end;
$$;

select public.test_assert(
  (
    select count(*)
    from pg_type
    where typnamespace = 'public'::regnamespace
      and typname in (
        'academy_publication_status',
        'academy_session_status',
        'academy_enrollment_status',
        'academy_question_status',
        'academy_difficulty',
        'academy_question_type'
      )
  ) = 6,
  'Expected all Academy enums to exist'
);

select public.test_assert(
  (
    select count(*)
    from pg_class
    where relnamespace = 'public'::regnamespace
      and relkind = 'r'
      and relname in (
        'academy_courses',
        'academy_modules',
        'academy_lessons',
        'academy_topics',
        'academy_enrollments',
        'academy_questions',
        'academy_question_options',
        'academy_quizzes',
        'academy_quiz_questions',
        'academy_quiz_sessions',
        'academy_quiz_answers',
        'academy_quiz_answer_options',
        'academy_flashcards',
        'academy_study_plans',
        'academy_study_plan_items',
        'academy_user_progress',
        'academy_user_settings'
      )
  ) = 17,
  'Expected all Academy tables to exist'
);

select public.test_assert(
  exists (
    select 1
    from pg_trigger
    where tgname = 'trg_academy_courses_updated_at'
  ),
  'Expected Academy updated_at trigger on academy_courses'
);

insert into auth.users (id, email)
values
  ('00000000-0000-0000-0000-0000000000a1', 'usera@example.com'),
  ('00000000-0000-0000-0000-0000000000b1', 'userb@example.com')
on conflict (id) do nothing;

insert into public.organizations (id, name, slug, plan)
values
  ('10000000-0000-0000-0000-000000000001', 'Org A', 'org-a', 'Free'),
  ('20000000-0000-0000-0000-000000000001', 'Org B', 'org-b', 'Free')
on conflict (id) do nothing;

insert into public.usuarios (
  id, nombre, apellido, email, rol, org_id
)
values
  ('00000000-0000-0000-0000-0000000000a1', 'User', 'A', 'usera@example.com', 'admin', '10000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-0000000000b1', 'User', 'B', 'userb@example.com', 'admin', '20000000-0000-0000-0000-000000000001')
on conflict (id) do update
set org_id = excluded.org_id;

insert into public.memberships (id, org_id, user_id, role)
values
  ('30000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 'owner'),
  ('30000000-0000-0000-0000-0000000000b1', '20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b1', 'owner')
on conflict (org_id, user_id) do nothing;

insert into public.academy_courses (
  id, org_id, slug, code, title, status, difficulty, estimated_minutes, created_by, updated_by
)
values
  ('40000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-000000000001', 'course-a', 'CA', 'Course A', 'draft', 'beginner', 60, '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1'),
  ('40000000-0000-0000-0000-0000000000b1', '20000000-0000-0000-0000-000000000001', 'course-b', 'CB', 'Course B', 'draft', 'beginner', 60, '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b1');

insert into public.academy_modules (
  id, org_id, course_id, slug, title, created_by, updated_by
)
values
  ('41000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-0000000000a1', 'module-a', 'Module A', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1'),
  ('41000000-0000-0000-0000-0000000000b1', '20000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-0000000000b1', 'module-b', 'Module B', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b1');

insert into public.academy_lessons (
  id, org_id, course_id, module_id, slug, title, created_by, updated_by
)
values
  ('42000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-0000000000a1', '41000000-0000-0000-0000-0000000000a1', 'lesson-a', 'Lesson A', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1'),
  ('42000000-0000-0000-0000-0000000000b1', '20000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-0000000000b1', '41000000-0000-0000-0000-0000000000b1', 'lesson-b', 'Lesson B', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b1');

insert into public.academy_topics (
  id, org_id, course_id, lesson_id, slug, title, created_by, updated_by
)
values
  ('43000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-0000000000a1', '42000000-0000-0000-0000-0000000000a1', 'topic-a', 'Topic A', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1'),
  ('43000000-0000-0000-0000-0000000000b1', '20000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-0000000000b1', '42000000-0000-0000-0000-0000000000b1', 'topic-b', 'Topic B', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b1');

insert into public.academy_questions (
  id, org_id, course_id, topic_id, question_type, status, difficulty, prompt, points, created_by, updated_by
)
values
  ('44000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-0000000000a1', '43000000-0000-0000-0000-0000000000a1', 'single_choice', 'active', 'beginner', 'Question A1', 1, '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1'),
  ('44000000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-0000000000a1', '43000000-0000-0000-0000-0000000000a1', 'multiple_choice', 'active', 'beginner', 'Question A2', 2, '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1'),
  ('44000000-0000-0000-0000-0000000000b1', '20000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-0000000000b1', '43000000-0000-0000-0000-0000000000b1', 'single_choice', 'active', 'beginner', 'Question B1', 1, '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b1');

insert into public.academy_question_options (
  id, org_id, question_id, option_key, label, sort_order, is_correct, created_by, updated_by
)
values
  ('45000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-000000000001', '44000000-0000-0000-0000-0000000000a1', 'A', 'Option A1', 0, true, '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1'),
  ('45000000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-000000000001', '44000000-0000-0000-0000-0000000000a2', 'A', 'Option A2-1', 0, true, '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1'),
  ('45000000-0000-0000-0000-0000000000a3', '10000000-0000-0000-0000-000000000001', '44000000-0000-0000-0000-0000000000a2', 'B', 'Option A2-2', 1, false, '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1'),
  ('45000000-0000-0000-0000-0000000000b1', '20000000-0000-0000-0000-000000000001', '44000000-0000-0000-0000-0000000000b1', 'A', 'Option B1', 0, true, '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b1');

insert into public.academy_quizzes (
  id, org_id, course_id, slug, title, quiz_kind, created_by, updated_by
)
values
  ('46000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-0000000000a1', 'quiz-a', 'Quiz A', 'practice', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1');

insert into public.academy_quiz_questions (
  id, org_id, quiz_id, course_id, question_id, sort_order, created_by, updated_by
)
values
  ('47000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-000000000001', '46000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1', '44000000-0000-0000-0000-0000000000a1', 1, '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1'),
  ('47000000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-000000000001', '46000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1', '44000000-0000-0000-0000-0000000000a2', 2, '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1');

insert into public.academy_enrollments (
  id, org_id, course_id, user_id, status, role_in_course, activated_at, created_by, updated_by
)
values
  ('48000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1', 'active', 'academy_student', now(), '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1'),
  ('48000000-0000-0000-0000-0000000000b1', '20000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b1', 'active', 'academy_student', now(), '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b1');

insert into public.academy_quiz_sessions (
  id, org_id, course_id, quiz_id, user_id, enrollment_id, attempt_number, status
)
values
  ('49000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-0000000000a1', '46000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1', '48000000-0000-0000-0000-0000000000a1', 1, 'in_progress'),
  ('49000000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-0000000000a1', '46000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1', '48000000-0000-0000-0000-0000000000a1', 2, 'in_progress');

insert into public.academy_quiz_answers (
  id, org_id, session_id, course_id, quiz_id, question_id, selected_option_id, is_correct, points_awarded
)
values
  ('50000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-000000000001', '49000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1', '46000000-0000-0000-0000-0000000000a1', '44000000-0000-0000-0000-0000000000a1', '45000000-0000-0000-0000-0000000000a1', true, 1),
  ('50000000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-000000000001', '49000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1', '46000000-0000-0000-0000-0000000000a1', '44000000-0000-0000-0000-0000000000a2', null, true, 2);

insert into public.academy_quiz_answer_options (
  id, org_id, answer_id, question_id, option_id
)
values
  ('51000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-0000000000a2', '44000000-0000-0000-0000-0000000000a2', '45000000-0000-0000-0000-0000000000a2');

insert into public.academy_user_progress (
  id, org_id, course_id, user_id, enrollment_id, lesson_id, mastery_percent
)
values
  ('52000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1', '48000000-0000-0000-0000-0000000000a1', '42000000-0000-0000-0000-0000000000a1', 75);

insert into public.academy_user_settings (
  id, org_id, course_id, user_id, enrollment_id, preferred_study_minutes, preferred_quiz_mode
)
values
  ('53000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1', '48000000-0000-0000-0000-0000000000a1', 30, 'practice');

commit;
begin;

do $$
declare
  before_update timestamptz;
  after_update timestamptz;
begin
  select updated_at into before_update
  from public.academy_courses
  where id = '40000000-0000-0000-0000-0000000000a1';

  perform pg_sleep(0.01);

  update public.academy_courses
  set title = 'Course A Updated'
  where id = '40000000-0000-0000-0000-0000000000a1';

  select updated_at into after_update
  from public.academy_courses
  where id = '40000000-0000-0000-0000-0000000000a1';

  perform public.test_assert(after_update > before_update, 'Expected academy_courses updated_at trigger to fire');
end
$$;

select public.test_expect_error(
  $sql$
    insert into public.academy_modules (
      id, org_id, course_id, slug, title, sort_order, created_by, updated_by
    ) values (
      '41000000-0000-0000-0000-00000000bad1',
      '10000000-0000-0000-0000-000000000001',
      '40000000-0000-0000-0000-0000000000b1',
      'bad-module',
      'Bad Module',
      99,
      '00000000-0000-0000-0000-0000000000a1',
      '00000000-0000-0000-0000-0000000000a1'
    )
  $sql$,
  '23503',
  'cross-org module/course fk'
);

select public.test_expect_error(
  $sql$
    insert into public.academy_lessons (
      id, org_id, course_id, module_id, slug, title, sort_order, created_by, updated_by
    ) values (
      '42000000-0000-0000-0000-00000000bad1',
      '10000000-0000-0000-0000-000000000001',
      '40000000-0000-0000-0000-0000000000a1',
      '41000000-0000-0000-0000-0000000000b1',
      'bad-lesson',
      'Bad Lesson',
      99,
      '00000000-0000-0000-0000-0000000000a1',
      '00000000-0000-0000-0000-0000000000a1'
    )
  $sql$,
  '23503',
  'cross-org lesson/module fk'
);

select public.test_expect_error(
  $sql$
    insert into public.academy_questions (
      id, org_id, course_id, topic_id, question_type, status, difficulty, prompt, points, sort_order, created_by, updated_by
    ) values (
      '44000000-0000-0000-0000-00000000bad1',
      '10000000-0000-0000-0000-000000000001',
      '40000000-0000-0000-0000-0000000000a1',
      '43000000-0000-0000-0000-0000000000b1',
      'single_choice',
      'active',
      'beginner',
      'Bad Question',
      1,
      99,
      '00000000-0000-0000-0000-0000000000a1',
      '00000000-0000-0000-0000-0000000000a1'
    )
  $sql$,
  '23503',
  'cross-org question/topic fk'
);

select public.test_expect_error(
  $sql$
    insert into public.academy_question_options (
      id, org_id, question_id, option_key, label, sort_order, is_correct, created_by, updated_by
    ) values (
      '45000000-0000-0000-0000-00000000bad1',
      '10000000-0000-0000-0000-000000000001',
      '44000000-0000-0000-0000-0000000000b1',
      'Z',
      'Bad Option',
      1,
      false,
      '00000000-0000-0000-0000-0000000000a1',
      '00000000-0000-0000-0000-0000000000a1'
    )
  $sql$,
  '23503',
  'cross-org option/question fk'
);

select public.test_expect_error(
  $sql$
    insert into public.academy_quiz_answers (
      id, org_id, session_id, course_id, quiz_id, question_id, selected_option_id
    ) values (
      '50000000-0000-0000-0000-00000000bad1',
      '10000000-0000-0000-0000-000000000001',
      '49000000-0000-0000-0000-0000000000a2',
      '40000000-0000-0000-0000-0000000000a1',
      '46000000-0000-0000-0000-0000000000a1',
      '44000000-0000-0000-0000-0000000000a1',
      '45000000-0000-0000-0000-0000000000a3'
    )
  $sql$,
  '23503',
  'answer option must belong to same question'
);

select public.test_expect_error(
  $sql$
    insert into public.academy_quiz_answer_options (
      id, org_id, answer_id, question_id, option_id
    ) values (
      '51000000-0000-0000-0000-00000000bad1',
      '10000000-0000-0000-0000-000000000001',
      '50000000-0000-0000-0000-0000000000a2',
      '44000000-0000-0000-0000-0000000000a2',
      '45000000-0000-0000-0000-0000000000a1'
    )
  $sql$,
  '23503',
  'multiple-choice join must use option from same question'
);

select public.test_expect_error(
  $sql$
    insert into public.academy_quiz_sessions (
      id, org_id, course_id, quiz_id, user_id, enrollment_id, attempt_number, status
    ) values (
      '49000000-0000-0000-0000-00000000bad1',
      '10000000-0000-0000-0000-000000000001',
      '40000000-0000-0000-0000-0000000000a1',
      '46000000-0000-0000-0000-0000000000a1',
      '00000000-0000-0000-0000-0000000000a1',
      '48000000-0000-0000-0000-0000000000b1',
      99,
      'in_progress'
    )
  $sql$,
  '23503',
  'session enrollment must match user and course'
);

select public.test_expect_error(
  $sql$
    insert into public.academy_user_progress (
      id, org_id, course_id, user_id, enrollment_id, topic_id
    ) values (
      '52000000-0000-0000-0000-00000000bad1',
      '10000000-0000-0000-0000-000000000001',
      '40000000-0000-0000-0000-0000000000a1',
      '00000000-0000-0000-0000-0000000000a1',
      '48000000-0000-0000-0000-0000000000b1',
      '43000000-0000-0000-0000-0000000000a1'
    )
  $sql$,
  '23503',
  'user_progress enrollment must match user and course'
);

select public.test_expect_error(
  $sql$
    insert into public.academy_user_progress (
      id, org_id, course_id, user_id, enrollment_id, lesson_id
    ) values (
      '52000000-0000-0000-0000-00000000bad2',
      '10000000-0000-0000-0000-000000000001',
      '40000000-0000-0000-0000-0000000000a1',
      '00000000-0000-0000-0000-0000000000a1',
      '48000000-0000-0000-0000-0000000000a1',
      '42000000-0000-0000-0000-0000000000a1'
    )
  $sql$,
  '23505',
  'user_progress partial unique lesson'
);

select public.test_expect_error(
  $sql$
    insert into public.academy_user_settings (
      id, org_id, course_id, user_id, enrollment_id, preferred_study_minutes
    ) values (
      '53000000-0000-0000-0000-00000000bad1',
      '10000000-0000-0000-0000-000000000001',
      '40000000-0000-0000-0000-0000000000a1',
      '00000000-0000-0000-0000-0000000000b1',
      '48000000-0000-0000-0000-0000000000b1',
      15
    )
  $sql$,
  '23503',
  'user_settings enrollment must match user and course'
);

select public.test_expect_error(
  $sql$
    delete from public.academy_courses
    where id = '40000000-0000-0000-0000-0000000000a1'
  $sql$,
  '23503',
  'course delete restricted by dependent module'
);

select public.test_assert(
  exists (
    select 1
    from public.academy_quiz_answer_options
    where answer_id = '50000000-0000-0000-0000-0000000000a2'
      and option_id = '45000000-0000-0000-0000-0000000000a2'
  ),
  'Expected relational multiple-choice join row to persist'
);

rollback;
