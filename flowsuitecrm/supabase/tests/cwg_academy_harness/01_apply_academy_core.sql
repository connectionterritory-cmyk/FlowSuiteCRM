\set ON_ERROR_STOP on
\if :{?academy_core_path}
\i :academy_core_path
\else
\echo 'academy_core_path variable is required'
\quit 3
\endif
