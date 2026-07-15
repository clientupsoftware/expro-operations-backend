--
-- PostgreSQL database dump
--

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;
SET default_tablespace = '';
SET default_table_access_method = heap;

CREATE TABLE public.asset_maintenance_log (
    id integer NOT NULL,
    asset_id integer NOT NULL,
    maintenance_rule_id integer,
    performed_at date DEFAULT CURRENT_DATE,
    runs_at_time integer,
    notes text,
    logged_by integer,
    operations_at_time integer DEFAULT 0
);
CREATE SEQUENCE public.asset_maintenance_log_id_seq AS integer START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
ALTER SEQUENCE public.asset_maintenance_log_id_seq OWNED BY public.asset_maintenance_log.id;

CREATE TABLE public.asset_run_resets (
    id integer NOT NULL,
    asset_id integer,
    previous_count integer NOT NULL,
    motivo text NOT NULL,
    reset_by integer,
    reset_at timestamp without time zone DEFAULT now(),
    previous_operations integer DEFAULT 0
);
CREATE SEQUENCE public.asset_run_resets_id_seq AS integer START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
ALTER SEQUENCE public.asset_run_resets_id_seq OWNED BY public.asset_run_resets.id;

CREATE TABLE public.asset_runs (
    id integer NOT NULL,
    asset_id integer NOT NULL,
    job_id integer,
    run_date date DEFAULT CURRENT_DATE,
    source character varying(50)
);
CREATE SEQUENCE public.asset_runs_id_seq AS integer START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
ALTER SEQUENCE public.asset_runs_id_seq OWNED BY public.asset_runs.id;

CREATE TABLE public.assets (
    id integer NOT NULL,
    equipment_catalog_id integer,
    sap_equipment_code character varying(50),
    description character varying(255),
    equipment_type character varying(50),
    serial_number character varying(100),
    system_status character varying(50),
    current_location character varying(150),
    max_working_pressure character varying(50),
    cert_annual_expiry date,
    cert_major_expiry date,
    cert_load_test_expiry date,
    cert_nde_expiry date,
    cert_visual_expiry date,
    cert_calibration_expiry date,
    cumulative_runs integer DEFAULT 0 NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    counting_since date DEFAULT CURRENT_DATE,
    cumulative_operations integer DEFAULT 0 NOT NULL
);
CREATE SEQUENCE public.assets_id_seq AS integer START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
ALTER SEQUENCE public.assets_id_seq OWNED BY public.assets.id;

CREATE TABLE public.bundle_stage_assets (
    id integer NOT NULL,
    bundle_stage_id integer,
    asset_id integer,
    string_label character varying(100)
);
CREATE SEQUENCE public.bundle_stage_assets_id_seq AS integer START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
ALTER SEQUENCE public.bundle_stage_assets_id_seq OWNED BY public.bundle_stage_assets.id;

CREATE TABLE public.bundle_stages (
    id integer NOT NULL,
    time_report_id integer,
    well_id integer,
    stage_number integer NOT NULL,
    fecha date,
    plug_type character varying(100),
    plug_size character varying(50),
    gun_od character varying(50),
    charge_type character varying(100),
    spf character varying(20),
    charge_qty integer,
    gun_qty integer,
    engineer character varying(150),
    crew_leader character varying(150),
    crew_member_2 character varying(150),
    crew_member_3 character varying(150),
    crew_member_4 character varying(150),
    time_well_to_wl time without time zone,
    time_rih time without time zone,
    time_start_pump_down time without time zone,
    time_poo time without time zone,
    time_bha_in_lubricator time without time zone,
    time_well_return time without time zone,
    well_pressure numeric,
    plug_problem boolean DEFAULT false,
    hse_issue boolean DEFAULT false,
    misfire boolean DEFAULT false,
    comentarios text,
    created_by integer,
    created_at timestamp without time zone DEFAULT now()
);
CREATE SEQUENCE public.bundle_stages_id_seq AS integer START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
ALTER SEQUENCE public.bundle_stages_id_seq OWNED BY public.bundle_stages.id;

CREATE TABLE public.clients (
    id integer NOT NULL,
    name character varying(150) NOT NULL
);
CREATE SEQUENCE public.clients_id_seq AS integer START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
ALTER SEQUENCE public.clients_id_seq OWNED BY public.clients.id;

CREATE TABLE public.crews (
    id integer NOT NULL,
    name character varying(100) NOT NULL,
    cycle_start_date date NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    work_days integer DEFAULT 14 NOT NULL,
    rest_days integer DEFAULT 7 NOT NULL
);
CREATE SEQUENCE public.crews_id_seq AS integer START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
ALTER SEQUENCE public.crews_id_seq OWNED BY public.crews.id;

CREATE TABLE public.daily_board_assignments (
    id integer NOT NULL,
    entry_id integer,
    role character varying(20) NOT NULL,
    turno character varying(10) NOT NULL,
    personnel_id integer,
    text_fallback character varying(150),
    CONSTRAINT daily_board_assignments_role_check CHECK (((role)::text = ANY ((ARRAY['supervisor'::character varying, 'guinchero'::character varying, 'ayudante'::character varying])::text[]))),
    CONSTRAINT daily_board_assignments_turno_check CHECK (((turno)::text = ANY ((ARRAY['dia'::character varying, 'noche'::character varying])::text[])))
);
CREATE SEQUENCE public.daily_board_assignments_id_seq AS integer START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
ALTER SEQUENCE public.daily_board_assignments_id_seq OWNED BY public.daily_board_assignments.id;

CREATE TABLE public.daily_board_crew (
    id integer NOT NULL,
    entry_id integer,
    personnel_id integer
);
CREATE SEQUENCE public.daily_board_crew_id_seq AS integer START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
ALTER SEQUENCE public.daily_board_crew_id_seq OWNED BY public.daily_board_crew.id;

CREATE TABLE public.daily_board_entries (
    id integer NOT NULL,
    estado character varying(30) DEFAULT 'proxima_operacion'::character varying NOT NULL,
    fecha date,
    unidad character varying(50),
    pozo character varying(150),
    tipo_unidad character varying(20),
    client_id integer,
    edp character varying(50),
    servicios character varying(255),
    supervisor character varying(150),
    comentarios text,
    job_id integer,
    created_by integer,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    supervisor_dia_text character varying(150),
    supervisor_noche_text character varying(150),
    guinchero_dia_text character varying(150),
    guinchero_noche_text character varying(150),
    CONSTRAINT daily_board_entries_estado_check CHECK (((estado)::text = ANY ((ARRAY['proxima_operacion'::character varying, 'en_operacion'::character varying, 'operacion_finalizada'::character varying, 'operacion_cancelada'::character varying, 'operacion_rechazada'::character varying])::text[])))
);
CREATE SEQUENCE public.daily_board_entries_id_seq AS integer START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
ALTER SEQUENCE public.daily_board_entries_id_seq OWNED BY public.daily_board_entries.id;

CREATE TABLE public.equipment_catalog (
    id integer NOT NULL,
    category character varying(60),
    model_description character varying(255) NOT NULL,
    counting_mode character varying(20) DEFAULT 'carrera'::character varying NOT NULL,
    CONSTRAINT equipment_catalog_counting_mode_check CHECK (((counting_mode)::text = ANY ((ARRAY['carrera'::character varying, 'operacion'::character varying])::text[])))
);
CREATE SEQUENCE public.equipment_catalog_id_seq AS integer START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
ALTER SEQUENCE public.equipment_catalog_id_seq OWNED BY public.equipment_catalog.id;

CREATE TABLE public.failure_report_assets (
    id integer NOT NULL,
    failure_report_id integer NOT NULL,
    asset_id integer NOT NULL,
    observaciones text
);
CREATE SEQUENCE public.failure_report_assets_id_seq AS integer START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
ALTER SEQUENCE public.failure_report_assets_id_seq OWNED BY public.failure_report_assets.id;

CREATE TABLE public.failure_report_photos (
    id integer NOT NULL,
    failure_report_id integer NOT NULL,
    file_path text NOT NULL,
    orden integer DEFAULT 0 NOT NULL
);
CREATE SEQUENCE public.failure_report_photos_id_seq AS integer START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
ALTER SEQUENCE public.failure_report_photos_id_seq OWNED BY public.failure_report_photos.id;

CREATE TABLE public.failure_reports (
    id integer NOT NULL,
    job_id integer,
    time_report_line_id integer,
    event_datetime timestamp without time zone NOT NULL,
    supervisor_id integer,
    cliente_id integer,
    pozo_etapa text,
    npt character varying(50),
    descripcion_que_sucedio text,
    descripcion_por_que text,
    acciones_inmediatas text,
    clasificacion_nivel character varying(20),
    causa_raiz text,
    accion_correctiva text,
    responsable_seguimiento_id integer,
    fecha_cierre date,
    estado character varying(20) DEFAULT 'borrador'::character varying NOT NULL,
    created_by integer,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);
CREATE SEQUENCE public.failure_reports_id_seq AS integer START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
ALTER SEQUENCE public.failure_reports_id_seq OWNED BY public.failure_reports.id;

CREATE TABLE public.job_assets (
    id integer NOT NULL,
    job_id integer,
    asset_id integer,
    kit_template_id integer,
    assigned_by integer,
    confirmed boolean DEFAULT false NOT NULL,
    confirmed_by integer,
    confirmed_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now()
);
CREATE SEQUENCE public.job_assets_id_seq AS integer START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
ALTER SEQUENCE public.job_assets_id_seq OWNED BY public.job_assets.id;

CREATE TABLE public.job_peripheral_options (
    id integer NOT NULL,
    name character varying(100) NOT NULL
);
CREATE SEQUENCE public.job_peripheral_options_id_seq AS integer START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
ALTER SEQUENCE public.job_peripheral_options_id_seq OWNED BY public.job_peripheral_options.id;

CREATE TABLE public.job_peripherals (
    job_id integer NOT NULL,
    option_id integer NOT NULL
);

CREATE TABLE public.job_services (
    job_id integer NOT NULL,
    service_id integer NOT NULL
);

CREATE TABLE public.job_wells (
    job_id integer NOT NULL,
    well_id integer NOT NULL
);

CREATE TABLE public.jobs (
    id integer NOT NULL,
    job_number character varying(50),
    pad_id integer NOT NULL,
    service_id integer,
    status character varying(30) DEFAULT 'activo'::character varying NOT NULL,
    created_by integer,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    rig_name character varying(100),
    well_status character varying(50),
    shut_in_tubing_pressure character varying(50),
    flowing_thp character varying(50),
    job_objective text,
    representante_cliente character varying(150),
    expro_representante character varying(150),
    supervisor_dia character varying(150),
    guinchero_dia character varying(150),
    asistente_dia character varying(150),
    supervisor_noche character varying(150),
    guinchero_noche character varying(150),
    asistente_noche character varying(150),
    unidad_liviana character varying(100),
    unidad_carga character varying(100),
    unidad_wl character varying(100),
    numero_wls character varying(100),
    power_pack character varying(100),
    wire_type_size character varying(100),
    consumables_used text,
    presion_bdp numeric,
    doble_dotacion character varying(5) DEFAULT 'NA'::character varying,
    CONSTRAINT jobs_doble_dotacion_check CHECK (((doble_dotacion)::text = ANY ((ARRAY['NA'::character varying, 'SI'::character varying, 'NO'::character varying])::text[])))
);
CREATE SEQUENCE public.jobs_id_seq AS integer START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
ALTER SEQUENCE public.jobs_id_seq OWNED BY public.jobs.id;

CREATE TABLE public.kit_template_items (
    id integer NOT NULL,
    kit_template_id integer,
    equipment_catalog_id integer,
    quantity integer DEFAULT 1 NOT NULL,
    asset_id integer
);
CREATE SEQUENCE public.kit_template_items_id_seq AS integer START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
ALTER SEQUENCE public.kit_template_items_id_seq OWNED BY public.kit_template_items.id;

CREATE TABLE public.kit_templates (
    id integer NOT NULL,
    name character varying(150) NOT NULL,
    category character varying(60),
    created_by integer,
    created_at timestamp without time zone DEFAULT now()
);
CREATE SEQUENCE public.kit_templates_id_seq AS integer START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
ALTER SEQUENCE public.kit_templates_id_seq OWNED BY public.kit_templates.id;

CREATE TABLE public.maintenance_rules (
    id integer NOT NULL,
    equipment_catalog_id integer NOT NULL,
    level character varying(10) NOT NULL,
    trigger_type character varying(20) NOT NULL,
    trigger_value integer,
    execution_location character varying(20),
    task_description text,
    CONSTRAINT maintenance_rules_execution_location_check CHECK (((execution_location)::text = ANY ((ARRAY['campo'::character varying, 'base'::character varying])::text[]))),
    CONSTRAINT maintenance_rules_trigger_type_check CHECK (((trigger_type)::text = ANY ((ARRAY['runs'::character varying, 'condition'::character varying, 'interpad'::character varying])::text[])))
);
CREATE SEQUENCE public.maintenance_rules_id_seq AS integer START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
ALTER SEQUENCE public.maintenance_rules_id_seq OWNED BY public.maintenance_rules.id;

CREATE TABLE public.pads (
    id integer NOT NULL,
    name character varying(150) NOT NULL,
    client_id integer NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);
CREATE SEQUENCE public.pads_id_seq AS integer START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
ALTER SEQUENCE public.pads_id_seq OWNED BY public.pads.id;

CREATE TABLE public.personnel (
    id integer NOT NULL,
    name character varying(150) NOT NULL,
    puesto character varying(100),
    crew_id integer,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    apellido character varying(100),
    nombre character varying(100),
    convenio character varying(100),
    numero_empleado character varying(50),
    dni_cuit character varying(50)
);
CREATE SEQUENCE public.personnel_id_seq AS integer START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
ALTER SEQUENCE public.personnel_id_seq OWNED BY public.personnel.id;

CREATE TABLE public.personnel_positions (
    id integer NOT NULL,
    name character varying(100) NOT NULL
);
CREATE SEQUENCE public.personnel_positions_id_seq AS integer START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
ALTER SEQUENCE public.personnel_positions_id_seq OWNED BY public.personnel_positions.id;

CREATE TABLE public.personnel_status_overrides (
    id integer NOT NULL,
    personnel_id integer,
    status character varying(40) NOT NULL,
    date_from date NOT NULL,
    date_to date NOT NULL,
    notas text,
    created_by integer,
    created_at timestamp without time zone DEFAULT now(),
    CONSTRAINT personnel_status_overrides_status_check CHECK (((status)::text = ANY ((ARRAY['franco_compensatorio'::character varying, 'franco_trabajado'::character varying, 'licencia_medica'::character varying, 'vacaciones'::character varying, 'curso'::character varying, 'mudanza_licencia_extraordinaria'::character varying, 'periodico'::character varying, 'otro'::character varying])::text[])))
);
CREATE SEQUENCE public.personnel_status_overrides_id_seq AS integer START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
ALTER SEQUENCE public.personnel_status_overrides_id_seq OWNED BY public.personnel_status_overrides.id;

CREATE TABLE public.physical_units (
    id integer NOT NULL,
    name character varying(100) NOT NULL
);
CREATE SEQUENCE public.physical_units_id_seq AS integer START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
ALTER SEQUENCE public.physical_units_id_seq OWNED BY public.physical_units.id;

CREATE TABLE public.required_tools (
    id integer NOT NULL,
    job_id integer,
    tool_description character varying(255) NOT NULL,
    quantity integer DEFAULT 1 NOT NULL,
    requested_by integer,
    created_at timestamp without time zone DEFAULT now()
);
CREATE SEQUENCE public.required_tools_id_seq AS integer START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
ALTER SEQUENCE public.required_tools_id_seq OWNED BY public.required_tools.id;

CREATE TABLE public.services (
    id integer NOT NULL,
    name character varying(100) NOT NULL
);
CREATE SEQUENCE public.services_id_seq AS integer START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
ALTER SEQUENCE public.services_id_seq OWNED BY public.services.id;

CREATE TABLE public.settings (
    key character varying(60) NOT NULL,
    value character varying(255) NOT NULL
);

CREATE TABLE public.shipping_list_items (
    id integer NOT NULL,
    shipping_list_id integer,
    asset_id integer,
    asset_name character varying(255),
    serial_number character varying(100)
);
CREATE SEQUENCE public.shipping_list_items_id_seq AS integer START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
ALTER SEQUENCE public.shipping_list_items_id_seq OWNED BY public.shipping_list_items.id;

CREATE TABLE public.shipping_lists (
    id integer NOT NULL,
    job_id integer,
    generated_at timestamp without time zone DEFAULT now()
);
CREATE SEQUENCE public.shipping_lists_id_seq AS integer START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
ALTER SEQUENCE public.shipping_lists_id_seq OWNED BY public.shipping_lists.id;

CREATE TABLE public.time_report_line_assets (
    id integer NOT NULL,
    time_report_line_id integer,
    asset_id integer,
    string_label character varying(100)
);
CREATE SEQUENCE public.time_report_line_assets_id_seq AS integer START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
ALTER SEQUENCE public.time_report_line_assets_id_seq OWNED BY public.time_report_line_assets.id;

CREATE TABLE public.time_report_lines (
    id integer NOT NULL,
    time_report_id integer,
    fecha date NOT NULL,
    desde time without time zone,
    hasta time without time zone,
    actividad text,
    operacion text,
    evento_misrun boolean DEFAULT false,
    profundidad_desde numeric,
    profundidad_hasta numeric,
    comentarios text,
    is_run boolean DEFAULT false NOT NULL,
    created_by integer,
    created_at timestamp without time zone DEFAULT now()
);
CREATE SEQUENCE public.time_report_lines_id_seq AS integer START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
ALTER SEQUENCE public.time_report_lines_id_seq OWNED BY public.time_report_lines.id;

CREATE TABLE public.time_report_operations (
    id integer NOT NULL,
    name character varying(100) NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);
CREATE SEQUENCE public.time_report_operations_id_seq AS integer START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
ALTER SEQUENCE public.time_report_operations_id_seq OWNED BY public.time_report_operations.id;

CREATE TABLE public.time_reports (
    id integer NOT NULL,
    job_id integer,
    report_type character varying(20) NOT NULL,
    created_by integer,
    created_at timestamp without time zone DEFAULT now(),
    rig_name character varying(100),
    well_status character varying(50),
    shut_in_tubing_pressure character varying(50),
    flowing_thp character varying(50),
    job_objective text,
    unidad_carga character varying(100),
    wire_type_size character varying(100),
    consumables_used text,
    expro_representante character varying(150),
    CONSTRAINT time_reports_report_type_check CHECK (((report_type)::text = ANY ((ARRAY['on_call'::character varying, 'bundle_pp'::character varying])::text[])))
);
CREATE SEQUENCE public.time_reports_id_seq AS integer START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
ALTER SEQUENCE public.time_reports_id_seq OWNED BY public.time_reports.id;

CREATE TABLE public.unit_types (
    id integer NOT NULL,
    name character varying(50) NOT NULL
);
CREATE SEQUENCE public.unit_types_id_seq AS integer START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
ALTER SEQUENCE public.unit_types_id_seq OWNED BY public.unit_types.id;

CREATE TABLE public.users (
    id integer NOT NULL,
    name character varying(120) NOT NULL,
    email character varying(160) NOT NULL,
    password_hash character varying(255) NOT NULL,
    role character varying(20) NOT NULL,
    active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT now(),
    CONSTRAINT users_role_check CHECK (((role)::text = ANY ((ARRAY['coordinador'::character varying, 'mantenimiento'::character varying, 'ingeniero'::character varying, 'super'::character varying])::text[])))
);
CREATE SEQUENCE public.users_id_seq AS integer START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;

CREATE TABLE public.wells (
    id integer NOT NULL,
    name character varying(150) NOT NULL,
    pad_id integer NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);
CREATE SEQUENCE public.wells_id_seq AS integer START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
ALTER SEQUENCE public.wells_id_seq OWNED BY public.wells.id;

CREATE VIEW public.v_assets_con_falla AS
 SELECT a.id AS asset_id,
    a.sap_equipment_code,
    a.description,
    a.equipment_type,
    fr.id AS failure_report_id,
    fr.event_datetime,
    fr.pozo_etapa,
    fr.clasificacion_nivel,
    fr.estado
   FROM ((public.failure_report_assets fra
     JOIN public.assets a ON ((a.id = fra.asset_id)))
     JOIN public.failure_reports fr ON ((fr.id = fra.failure_report_id)))
  ORDER BY fr.event_datetime DESC;

ALTER TABLE ONLY public.asset_maintenance_log ALTER COLUMN id SET DEFAULT nextval('public.asset_maintenance_log_id_seq'::regclass);
ALTER TABLE ONLY public.asset_run_resets ALTER COLUMN id SET DEFAULT nextval('public.asset_run_resets_id_seq'::regclass);
ALTER TABLE ONLY public.asset_runs ALTER COLUMN id SET DEFAULT nextval('public.asset_runs_id_seq'::regclass);
ALTER TABLE ONLY public.assets ALTER COLUMN id SET DEFAULT nextval('public.assets_id_seq'::regclass);
ALTER TABLE ONLY public.bundle_stage_assets ALTER COLUMN id SET DEFAULT nextval('public.bundle_stage_assets_id_seq'::regclass);
ALTER TABLE ONLY public.bundle_stages ALTER COLUMN id SET DEFAULT nextval('public.bundle_stages_id_seq'::regclass);
ALTER TABLE ONLY public.clients ALTER COLUMN id SET DEFAULT nextval('public.clients_id_seq'::regclass);
ALTER TABLE ONLY public.crews ALTER COLUMN id SET DEFAULT nextval('public.crews_id_seq'::regclass);
ALTER TABLE ONLY public.daily_board_assignments ALTER COLUMN id SET DEFAULT nextval('public.daily_board_assignments_id_seq'::regclass);
ALTER TABLE ONLY public.daily_board_crew ALTER COLUMN id SET DEFAULT nextval('public.daily_board_crew_id_seq'::regclass);
ALTER TABLE ONLY public.daily_board_entries ALTER COLUMN id SET DEFAULT nextval('public.daily_board_entries_id_seq'::regclass);
ALTER TABLE ONLY public.equipment_catalog ALTER COLUMN id SET DEFAULT nextval('public.equipment_catalog_id_seq'::regclass);
ALTER TABLE ONLY public.failure_report_assets ALTER COLUMN id SET DEFAULT nextval('public.failure_report_assets_id_seq'::regclass);
ALTER TABLE ONLY public.failure_report_photos ALTER COLUMN id SET DEFAULT nextval('public.failure_report_photos_id_seq'::regclass);
ALTER TABLE ONLY public.failure_reports ALTER COLUMN id SET DEFAULT nextval('public.failure_reports_id_seq'::regclass);
ALTER TABLE ONLY public.job_assets ALTER COLUMN id SET DEFAULT nextval('public.job_assets_id_seq'::regclass);
ALTER TABLE ONLY public.job_peripheral_options ALTER COLUMN id SET DEFAULT nextval('public.job_peripheral_options_id_seq'::regclass);
ALTER TABLE ONLY public.jobs ALTER COLUMN id SET DEFAULT nextval('public.jobs_id_seq'::regclass);
ALTER TABLE ONLY public.kit_template_items ALTER COLUMN id SET DEFAULT nextval('public.kit_template_items_id_seq'::regclass);
ALTER TABLE ONLY public.kit_templates ALTER COLUMN id SET DEFAULT nextval('public.kit_templates_id_seq'::regclass);
ALTER TABLE ONLY public.maintenance_rules ALTER COLUMN id SET DEFAULT nextval('public.maintenance_rules_id_seq'::regclass);
ALTER TABLE ONLY public.pads ALTER COLUMN id SET DEFAULT nextval('public.pads_id_seq'::regclass);
ALTER TABLE ONLY public.personnel ALTER COLUMN id SET DEFAULT nextval('public.personnel_id_seq'::regclass);
ALTER TABLE ONLY public.personnel_positions ALTER COLUMN id SET DEFAULT nextval('public.personnel_positions_id_seq'::regclass);
ALTER TABLE ONLY public.personnel_status_overrides ALTER COLUMN id SET DEFAULT nextval('public.personnel_status_overrides_id_seq'::regclass);
ALTER TABLE ONLY public.physical_units ALTER COLUMN id SET DEFAULT nextval('public.physical_units_id_seq'::regclass);
ALTER TABLE ONLY public.required_tools ALTER COLUMN id SET DEFAULT nextval('public.required_tools_id_seq'::regclass);
ALTER TABLE ONLY public.services ALTER COLUMN id SET DEFAULT nextval('public.services_id_seq'::regclass);
ALTER TABLE ONLY public.shipping_list_items ALTER COLUMN id SET DEFAULT nextval('public.shipping_list_items_id_seq'::regclass);
ALTER TABLE ONLY public.shipping_lists ALTER COLUMN id SET DEFAULT nextval('public.shipping_lists_id_seq'::regclass);
ALTER TABLE ONLY public.time_report_line_assets ALTER COLUMN id SET DEFAULT nextval('public.time_report_line_assets_id_seq'::regclass);
ALTER TABLE ONLY public.time_report_lines ALTER COLUMN id SET DEFAULT nextval('public.time_report_lines_id_seq'::regclass);
ALTER TABLE ONLY public.time_report_operations ALTER COLUMN id SET DEFAULT nextval('public.time_report_operations_id_seq'::regclass);
ALTER TABLE ONLY public.time_reports ALTER COLUMN id SET DEFAULT nextval('public.time_reports_id_seq'::regclass);
ALTER TABLE ONLY public.unit_types ALTER COLUMN id SET DEFAULT nextval('public.unit_types_id_seq'::regclass);
ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);
ALTER TABLE ONLY public.wells ALTER COLUMN id SET DEFAULT nextval('public.wells_id_seq'::regclass);

ALTER TABLE ONLY public.asset_maintenance_log ADD CONSTRAINT asset_maintenance_log_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.asset_run_resets ADD CONSTRAINT asset_run_resets_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.asset_runs ADD CONSTRAINT asset_runs_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.assets ADD CONSTRAINT assets_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.assets ADD CONSTRAINT assets_sap_equipment_code_key UNIQUE (sap_equipment_code);
ALTER TABLE ONLY public.bundle_stage_assets ADD CONSTRAINT bundle_stage_assets_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.bundle_stages ADD CONSTRAINT bundle_stages_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.clients ADD CONSTRAINT clients_name_key UNIQUE (name);
ALTER TABLE ONLY public.clients ADD CONSTRAINT clients_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.crews ADD CONSTRAINT crews_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.daily_board_assignments ADD CONSTRAINT daily_board_assignments_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.daily_board_crew ADD CONSTRAINT daily_board_crew_entry_id_personnel_id_key UNIQUE (entry_id, personnel_id);
ALTER TABLE ONLY public.daily_board_crew ADD CONSTRAINT daily_board_crew_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.daily_board_entries ADD CONSTRAINT daily_board_entries_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.equipment_catalog ADD CONSTRAINT equipment_catalog_category_model_description_key UNIQUE (category, model_description);
ALTER TABLE ONLY public.equipment_catalog ADD CONSTRAINT equipment_catalog_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.failure_report_assets ADD CONSTRAINT failure_report_assets_failure_report_id_asset_id_key UNIQUE (failure_report_id, asset_id);
ALTER TABLE ONLY public.failure_report_assets ADD CONSTRAINT failure_report_assets_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.failure_report_photos ADD CONSTRAINT failure_report_photos_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.failure_reports ADD CONSTRAINT failure_reports_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.job_assets ADD CONSTRAINT job_assets_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.job_peripheral_options ADD CONSTRAINT job_peripheral_options_name_key UNIQUE (name);
ALTER TABLE ONLY public.job_peripheral_options ADD CONSTRAINT job_peripheral_options_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.job_peripherals ADD CONSTRAINT job_peripherals_pkey PRIMARY KEY (job_id, option_id);
ALTER TABLE ONLY public.job_services ADD CONSTRAINT job_services_pkey PRIMARY KEY (job_id, service_id);
ALTER TABLE ONLY public.job_wells ADD CONSTRAINT job_wells_pkey PRIMARY KEY (job_id, well_id);
ALTER TABLE ONLY public.jobs ADD CONSTRAINT jobs_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.kit_template_items ADD CONSTRAINT kit_template_items_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.kit_templates ADD CONSTRAINT kit_templates_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.maintenance_rules ADD CONSTRAINT maintenance_rules_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.pads ADD CONSTRAINT pads_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.personnel ADD CONSTRAINT personnel_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.personnel_positions ADD CONSTRAINT personnel_positions_name_key UNIQUE (name);
ALTER TABLE ONLY public.personnel_positions ADD CONSTRAINT personnel_positions_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.personnel_status_overrides ADD CONSTRAINT personnel_status_overrides_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.physical_units ADD CONSTRAINT physical_units_name_key UNIQUE (name);
ALTER TABLE ONLY public.physical_units ADD CONSTRAINT physical_units_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.required_tools ADD CONSTRAINT required_tools_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.services ADD CONSTRAINT services_name_key UNIQUE (name);
ALTER TABLE ONLY public.services ADD CONSTRAINT services_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.settings ADD CONSTRAINT settings_pkey PRIMARY KEY (key);
ALTER TABLE ONLY public.shipping_list_items ADD CONSTRAINT shipping_list_items_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.shipping_lists ADD CONSTRAINT shipping_lists_job_id_key UNIQUE (job_id);
ALTER TABLE ONLY public.shipping_lists ADD CONSTRAINT shipping_lists_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.time_report_line_assets ADD CONSTRAINT time_report_line_assets_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.time_report_lines ADD CONSTRAINT time_report_lines_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.time_report_operations ADD CONSTRAINT time_report_operations_name_key UNIQUE (name);
ALTER TABLE ONLY public.time_report_operations ADD CONSTRAINT time_report_operations_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.time_reports ADD CONSTRAINT time_reports_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.unit_types ADD CONSTRAINT unit_types_name_key UNIQUE (name);
ALTER TABLE ONLY public.unit_types ADD CONSTRAINT unit_types_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.users ADD CONSTRAINT users_email_key UNIQUE (email);
ALTER TABLE ONLY public.users ADD CONSTRAINT users_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.wells ADD CONSTRAINT wells_pkey PRIMARY KEY (id);

CREATE INDEX idx_assets_catalog ON public.assets USING btree (equipment_catalog_id);
CREATE INDEX idx_failure_report_assets_asset ON public.failure_report_assets USING btree (asset_id);
CREATE INDEX idx_failure_report_assets_report ON public.failure_report_assets USING btree (failure_report_id);
CREATE INDEX idx_failure_reports_job ON public.failure_reports USING btree (job_id);
CREATE INDEX idx_job_assets_job ON public.job_assets USING btree (job_id);

ALTER TABLE ONLY public.asset_maintenance_log ADD CONSTRAINT asset_maintenance_log_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES public.assets(id);
ALTER TABLE ONLY public.asset_maintenance_log ADD CONSTRAINT asset_maintenance_log_logged_by_fkey FOREIGN KEY (logged_by) REFERENCES public.users(id);
ALTER TABLE ONLY public.asset_maintenance_log ADD CONSTRAINT asset_maintenance_log_maintenance_rule_id_fkey FOREIGN KEY (maintenance_rule_id) REFERENCES public.maintenance_rules(id);
ALTER TABLE ONLY public.asset_run_resets ADD CONSTRAINT asset_run_resets_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES public.assets(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.asset_run_resets ADD CONSTRAINT asset_run_resets_reset_by_fkey FOREIGN KEY (reset_by) REFERENCES public.users(id);
ALTER TABLE ONLY public.asset_runs ADD CONSTRAINT asset_runs_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES public.assets(id);
ALTER TABLE ONLY public.asset_runs ADD CONSTRAINT asset_runs_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.jobs(id);
ALTER TABLE ONLY public.assets ADD CONSTRAINT assets_equipment_catalog_id_fkey FOREIGN KEY (equipment_catalog_id) REFERENCES public.equipment_catalog(id);
ALTER TABLE ONLY public.bundle_stage_assets ADD CONSTRAINT bundle_stage_assets_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES public.assets(id);
ALTER TABLE ONLY public.bundle_stage_assets ADD CONSTRAINT bundle_stage_assets_bundle_stage_id_fkey FOREIGN KEY (bundle_stage_id) REFERENCES public.bundle_stages(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.bundle_stages ADD CONSTRAINT bundle_stages_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);
ALTER TABLE ONLY public.bundle_stages ADD CONSTRAINT bundle_stages_time_report_id_fkey FOREIGN KEY (time_report_id) REFERENCES public.time_reports(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.bundle_stages ADD CONSTRAINT bundle_stages_well_id_fkey FOREIGN KEY (well_id) REFERENCES public.wells(id);
ALTER TABLE ONLY public.daily_board_assignments ADD CONSTRAINT daily_board_assignments_entry_id_fkey FOREIGN KEY (entry_id) REFERENCES public.daily_board_entries(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.daily_board_assignments ADD CONSTRAINT daily_board_assignments_personnel_id_fkey FOREIGN KEY (personnel_id) REFERENCES public.personnel(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.daily_board_crew ADD CONSTRAINT daily_board_crew_entry_id_fkey FOREIGN KEY (entry_id) REFERENCES public.daily_board_entries(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.daily_board_crew ADD CONSTRAINT daily_board_crew_personnel_id_fkey FOREIGN KEY (personnel_id) REFERENCES public.personnel(id);
ALTER TABLE ONLY public.daily_board_entries ADD CONSTRAINT daily_board_entries_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id);
ALTER TABLE ONLY public.daily_board_entries ADD CONSTRAINT daily_board_entries_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);
ALTER TABLE ONLY public.daily_board_entries ADD CONSTRAINT daily_board_entries_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.jobs(id);
ALTER TABLE ONLY public.failure_report_assets ADD CONSTRAINT failure_report_assets_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES public.assets(id);
ALTER TABLE ONLY public.failure_report_assets ADD CONSTRAINT failure_report_assets_failure_report_id_fkey FOREIGN KEY (failure_report_id) REFERENCES public.failure_reports(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.failure_report_photos ADD CONSTRAINT failure_report_photos_failure_report_id_fkey FOREIGN KEY (failure_report_id) REFERENCES public.failure_reports(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.failure_reports ADD CONSTRAINT failure_reports_cliente_id_fkey FOREIGN KEY (cliente_id) REFERENCES public.clients(id);
ALTER TABLE ONLY public.failure_reports ADD CONSTRAINT failure_reports_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);
ALTER TABLE ONLY public.failure_reports ADD CONSTRAINT failure_reports_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.jobs(id);
ALTER TABLE ONLY public.failure_reports ADD CONSTRAINT failure_reports_responsable_seguimiento_id_fkey FOREIGN KEY (responsable_seguimiento_id) REFERENCES public.personnel(id);
ALTER TABLE ONLY public.failure_reports ADD CONSTRAINT failure_reports_supervisor_id_fkey FOREIGN KEY (supervisor_id) REFERENCES public.personnel(id);
ALTER TABLE ONLY public.failure_reports ADD CONSTRAINT failure_reports_time_report_line_id_fkey FOREIGN KEY (time_report_line_id) REFERENCES public.time_report_lines(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.job_assets ADD CONSTRAINT job_assets_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES public.assets(id);
ALTER TABLE ONLY public.job_assets ADD CONSTRAINT job_assets_assigned_by_fkey FOREIGN KEY (assigned_by) REFERENCES public.users(id);
ALTER TABLE ONLY public.job_assets ADD CONSTRAINT job_assets_confirmed_by_fkey FOREIGN KEY (confirmed_by) REFERENCES public.users(id);
ALTER TABLE ONLY public.job_assets ADD CONSTRAINT job_assets_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.jobs(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.job_assets ADD CONSTRAINT job_assets_kit_template_id_fkey FOREIGN KEY (kit_template_id) REFERENCES public.kit_templates(id);
ALTER TABLE ONLY public.job_peripherals ADD CONSTRAINT job_peripherals_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.jobs(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.job_peripherals ADD CONSTRAINT job_peripherals_option_id_fkey FOREIGN KEY (option_id) REFERENCES public.job_peripheral_options(id);
ALTER TABLE ONLY public.job_services ADD CONSTRAINT job_services_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.jobs(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.job_services ADD CONSTRAINT job_services_service_id_fkey FOREIGN KEY (service_id) REFERENCES public.services(id);
ALTER TABLE ONLY public.job_wells ADD CONSTRAINT job_wells_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.jobs(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.job_wells ADD CONSTRAINT job_wells_well_id_fkey FOREIGN KEY (well_id) REFERENCES public.wells(id);
ALTER TABLE ONLY public.jobs ADD CONSTRAINT jobs_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);
ALTER TABLE ONLY public.jobs ADD CONSTRAINT jobs_pad_id_fkey FOREIGN KEY (pad_id) REFERENCES public.pads(id);
ALTER TABLE ONLY public.jobs ADD CONSTRAINT jobs_service_id_fkey FOREIGN KEY (service_id) REFERENCES public.services(id);
ALTER TABLE ONLY public.kit_template_items ADD CONSTRAINT kit_template_items_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES public.assets(id);
ALTER TABLE ONLY public.kit_template_items ADD CONSTRAINT kit_template_items_equipment_catalog_id_fkey FOREIGN KEY (equipment_catalog_id) REFERENCES public.equipment_catalog(id);
ALTER TABLE ONLY public.kit_template_items ADD CONSTRAINT kit_template_items_kit_template_id_fkey FOREIGN KEY (kit_template_id) REFERENCES public.kit_templates(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.kit_templates ADD CONSTRAINT kit_templates_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);
ALTER TABLE ONLY public.maintenance_rules ADD CONSTRAINT maintenance_rules_equipment_catalog_id_fkey FOREIGN KEY (equipment_catalog_id) REFERENCES public.equipment_catalog(id);
ALTER TABLE ONLY public.pads ADD CONSTRAINT pads_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id);
ALTER TABLE ONLY public.personnel ADD CONSTRAINT personnel_crew_id_fkey FOREIGN KEY (crew_id) REFERENCES public.crews(id);
ALTER TABLE ONLY public.personnel_status_overrides ADD CONSTRAINT personnel_status_overrides_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);
ALTER TABLE ONLY public.personnel_status_overrides ADD CONSTRAINT personnel_status_overrides_personnel_id_fkey FOREIGN KEY (personnel_id) REFERENCES public.personnel(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.required_tools ADD CONSTRAINT required_tools_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.jobs(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.required_tools ADD CONSTRAINT required_tools_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES public.users(id);
ALTER TABLE ONLY public.shipping_list_items ADD CONSTRAINT shipping_list_items_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES public.assets(id);
ALTER TABLE ONLY public.shipping_list_items ADD CONSTRAINT shipping_list_items_shipping_list_id_fkey FOREIGN KEY (shipping_list_id) REFERENCES public.shipping_lists(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.shipping_lists ADD CONSTRAINT shipping_lists_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.jobs(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.time_report_line_assets ADD CONSTRAINT time_report_line_assets_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES public.assets(id);
ALTER TABLE ONLY public.time_report_line_assets ADD CONSTRAINT time_report_line_assets_time_report_line_id_fkey FOREIGN KEY (time_report_line_id) REFERENCES public.time_report_lines(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.time_report_lines ADD CONSTRAINT time_report_lines_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);
ALTER TABLE ONLY public.time_report_lines ADD CONSTRAINT time_report_lines_time_report_id_fkey FOREIGN KEY (time_report_id) REFERENCES public.time_reports(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.time_reports ADD CONSTRAINT time_reports_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);
ALTER TABLE ONLY public.time_reports ADD CONSTRAINT time_reports_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.jobs(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.wells ADD CONSTRAINT wells_pad_id_fkey FOREIGN KEY (pad_id) REFERENCES public.pads(id);

INSERT INTO public.settings (key, value) VALUES ('cert_semaphore_threshold_days', '30') ON CONFLICT (key) DO NOTHING;
