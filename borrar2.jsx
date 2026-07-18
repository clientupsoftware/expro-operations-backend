import React, { useState, useEffect } from 'react';
import { api } from './api.js';
import Collapsible from './Collapsible.jsx';

const CAN_MANAGE_ROLES = ['mantenimiento', 'super'];

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function defaultConfig(defaultTypeId) {
  return {
    explosive_type_id: defaultTypeId || '',
    diametro_canon: '', cantidad_clusters: '', largo_cluster_ft: '',
    spf: '', fase: '', cargas_por_cluster: '', tpn: 'Y'
  };
}
function defaultTypology(defaultTypeId) {
  return { nombre: '', configs: [defaultConfig(defaultTypeId)] };
}
function defaultWell(defaultTypeId) {
  return { pozo: '', cantidad_etapas: '', typologies: [defaultTypology(defaultTypeId)] };
}

// ================= TIPOS DE EXPLOSIVOS (catalogo) =================
function ExplosiveTypesSection({ canManage, onTypesChanged }) {
  const [types, setTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ descripcion: '', tipo: '', fabricante: '', numero_renar: '', numero_sap: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => { load(); }, []);

  function load() {
    setLoading(true);
    api.getExplosiveTypes()
      .then((t) => { setTypes(t); onTypesChanged(t); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  function openCreate() {
    setEditingId(null);
    setForm({ descripcion: '', tipo: '', fabricante: '', numero_renar: '', numero_sap: '' });
    setShowForm(true);
  }
  function openEdit(t) {
    setEditingId(t.id);
    setForm({ descripcion: t.descripcion || '', tipo: t.tipo || '', fabricante: t.fabricante || '', numero_renar: t.numero_renar || '', numero_sap: t.numero_sap || '' });
    setShowForm(true);
  }
  function closeForm() { setShowForm(false); setEditingId(null); }

  async function handleSave(e) {
    e.preventDefault();
    if (!form.descripcion.trim()) { setError('La descripcion es requerida.'); return; }
    setSaving(true);
    setError(null);
    try {
      if (editingId) await api.updateExplosiveType(editingId, form);
      else await api.createExplosiveType(form);
      closeForm();
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id) {
    if (!window.confirm('¿Eliminar este tipo de explosivo? No se puede borrar si ya esta usado en algun programa.')) return;
    try {
      await api.deleteExplosiveType(id);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <Collapsible title="Tipos de Explosivos" badge={types.length}>
      {error && <div className="error-banner">{error}</div>}
      {canManage && (
        <div style={{ marginBottom: 14 }}>
          <button className="btn" onClick={() => (showForm ? closeForm() : openCreate())}>
            {showForm ? 'Cerrar' : '+ Agregar tipo'}
          </button>
        </div>
      )}

      {loading ? (
        <div className="empty-state">Cargando...</div>
      ) : types.length === 0 ? (
        <div className="empty-state">Todavia no hay tipos de explosivos cargados. Cargá al menos uno antes de crear un Programa.</div>
      ) : (
        <table className="data-table" style={{ marginBottom: showForm ? 16 : 0 }}>
          <thead><tr><th>Descripcion</th><th>Tipo</th><th>Fabricante</th><th>N Renar</th><th>N SAP</th>{canManage && <th></th>}</tr></thead>
          <tbody>
            {types.map((t) => (
              <tr key={t.id}>
                <td>{t.descripcion}</td>
                <td>{t.tipo || '-'}</td>
                <td>{t.fabricante || '-'}</td>
                <td className="mono">{t.numero_renar || '-'}</td>
                <td className="mono">{t.numero_sap || '-'}</td>
                {canManage && (
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn-secondary btn" style={{ padding: '4px 8px', fontSize: 11, marginRight: 6 }} onClick={() => openEdit(t)}>Editar</button>
                    <button className="btn-secondary btn" style={{ padding: '4px 8px', fontSize: 11, color: 'var(--danger)' }} onClick={() => handleDelete(t.id)}>Eliminar</button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {showForm && (
        <form onSubmit={handleSave} style={{ paddingTop: types.length ? 16 : 0, borderTop: types.length ? '1px solid var(--border)' : 'none' }}>
          <div className="form-row">
            <div className="field"><label>Descripcion</label><input value={form.descripcion} onChange={(e) => setForm({ ...form, descripcion: e.target.value })} placeholder="ej: Carga HMX 22g" /></div>
            <div className="field"><label>Tipo</label><input value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })} placeholder="ej: Deep Penetrating" /></div>
          </div>
          <div className="form-row">
            <div className="field"><label>Fabricante</label><input value={form.fabricante} onChange={(e) => setForm({ ...form, fabricante: e.target.value })} /></div>
            <div className="field"><label>N Renar</label><input value={form.numero_renar} onChange={(e) => setForm({ ...form, numero_renar: e.target.value })} /></div>
            <div className="field"><label>N SAP</label><input value={form.numero_sap} onChange={(e) => setForm({ ...form, numero_sap: e.target.value })} /></div>
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
            <button type="submit" className="btn" disabled={saving}>{saving ? 'Guardando...' : editingId ? 'Guardar cambios' : 'Agregar'}</button>
            <button type="button" className="btn-secondary btn" onClick={closeForm}>Cancelar</button>
          </div>
        </form>
      )}
    </Collapsible>
  );
}

// ================= Campos de una Configuracion =================
function ConfigFields({ config, explosiveTypes, onChange }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 8 }}>
      <div className="field" style={{ gridColumn: 'span 2' }}>
        <label>Tipo de Explosivo</label>
        <select value={config.explosive_type_id} onChange={(e) => onChange('explosive_type_id', e.target.value)}>
          <option value="">Elegir...</option>
          {explosiveTypes.map((t) => (<option key={t.id} value={t.id}>{t.descripcion}</option>))}
        </select>
      </div>
      <div className="field"><label>Diam. Cañon</label><input value={config.diametro_canon} onChange={(e) => onChange('diametro_canon', e.target.value)} placeholder='3-1/8"' /></div>
      <div className="field"><label>Cant. Clusters</label><input type="number" value={config.cantidad_clusters} onChange={(e) => onChange('cantidad_clusters', e.target.value)} /></div>
      <div className="field"><label>Largo Cluster (ft)</label><input type="number" step="0.01" value={config.largo_cluster_ft} onChange={(e) => onChange('largo_cluster_ft', e.target.value)} /></div>
      <div className="field"><label>SPF</label><input type="number" step="0.1" value={config.spf} onChange={(e) => onChange('spf', e.target.value)} /></div>
      <div className="field"><label>Fase</label><input value={config.fase} onChange={(e) => onChange('fase', e.target.value)} placeholder="60" /></div>
      <div className="field"><label>Cargas/Cluster</label><input type="number" value={config.cargas_por_cluster} onChange={(e) => onChange('cargas_por_cluster', e.target.value)} /></div>
      <div className="field">
        <label>TPN</label>
        <select value={config.tpn} onChange={(e) => onChange('tpn', e.target.value)}>
          <option value="Y">Y</option>
          <option value="N">N</option>
        </select>
      </div>
    </div>
  );
}

// Calcula el consumo total por tipo de explosivo a partir del estado local (sin guardar).
function calcularConsumoLocal(wells, explosiveTypes) {
  const porTipo = {};
  for (const well of wells) {
    const etapas = Number(well.cantidad_etapas) || 0;
    for (const typology of well.typologies) {
      for (const config of typology.configs) {
        if (!config.explosive_type_id) continue;
        const cantidad = (Number(config.cantidad_clusters) || 0) * (Number(config.cargas_por_cluster) || 0) * etapas;
        if (!porTipo[config.explosive_type_id]) {
          const tipo = explosiveTypes.find((t) => String(t.id) === String(config.explosive_type_id));
          porTipo[config.explosive_type_id] = { explosive_type_id: config.explosive_type_id, descripcion: tipo ? tipo.descripcion : '?', cantidad: 0 };
        }
        porTipo[config.explosive_type_id].cantidad += cantidad;
      }
    }
  }
  return Object.values(porTipo);
}

// ================= Formulario de Crear/Editar Programa =================
function ProgramFormSection({ clients, explosiveTypes, editingProgram, onSaved, onCancelEdit }) {
  const defaultTypeId = explosiveTypes[0]?.id || '';
  const [fecha, setFecha] = useState(todayStr());
  const [nombre, setNombre] = useState('');
  const [clienteId, setClienteId] = useState('');
  const [pad, setPad] = useState('');
  const [wells, setWells] = useState([defaultWell(defaultTypeId)]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (editingProgram) {
      setFecha(editingProgram.fecha ? String(editingProgram.fecha).slice(0, 10) : todayStr());
      setNombre(editingProgram.nombre || '');
      setClienteId(editingProgram.cliente_id || '');
      setPad(editingProgram.pad || '');
      setWells(editingProgram.wells.map((w) => ({
        pozo: w.pozo || '',
        cantidad_etapas: w.cantidad_etapas ?? '',
        typologies: w.typologies.map((t) => ({
          nombre: t.nombre || '',
          configs: t.configs.map((c) => ({
            explosive_type_id: c.explosive_type_id || '',
            diametro_canon: c.diametro_canon || '',
            cantidad_clusters: c.cantidad_clusters ?? '',
            largo_cluster_ft: c.largo_cluster_ft ?? '',
            spf: c.spf ?? '',
            fase: c.fase || '',
            cargas_por_cluster: c.cargas_por_cluster ?? '',
            tpn: c.tpn || 'Y'
          }))
        }))
      })));
    }
  }, [editingProgram]);

  function addWell() { setWells((prev) => [...prev, defaultWell(defaultTypeId)]); }
  function removeWell(idx) { setWells((prev) => prev.filter((_, i) => i !== idx)); }
  function updateWellField(idx, field, value) { setWells((prev) => prev.map((w, i) => (i === idx ? { ...w, [field]: value } : w))); }

  function addTypology(wellIdx) {
    setWells((prev) => prev.map((w, i) => (i === wellIdx ? { ...w, typologies: [...w.typologies, defaultTypology(defaultTypeId)] } : w)));
  }
  function removeTypology(wellIdx, typIdx) {
    setWells((prev) => prev.map((w, i) => (i === wellIdx ? { ...w, typologies: w.typologies.filter((_, ti) => ti !== typIdx) } : w)));
  }
  function updateTypologyNombre(wellIdx, typIdx, value) {
    setWells((prev) => prev.map((w, i) => (i === wellIdx
      ? { ...w, typologies: w.typologies.map((t, ti) => (ti === typIdx ? { ...t, nombre: value } : t)) }
      : w)));
  }

  function addConfig(wellIdx, typIdx) {
    setWells((prev) => prev.map((w, i) => (i === wellIdx
      ? { ...w, typologies: w.typologies.map((t, ti) => (ti === typIdx ? { ...t, configs: [...t.configs, defaultConfig(defaultTypeId)] } : t)) }
      : w)));
  }
  function removeConfig(wellIdx, typIdx, cfgIdx) {
    setWells((prev) => prev.map((w, i) => (i === wellIdx
      ? { ...w, typologies: w.typologies.map((t, ti) => (ti === typIdx ? { ...t, configs: t.configs.filter((_, ci) => ci !== cfgIdx) } : t)) }
      : w)));
  }
  function updateConfigField(wellIdx, typIdx, cfgIdx, field, value) {
    setWells((prev) => prev.map((w, i) => (i === wellIdx
      ? {
          ...w,
          typologies: w.typologies.map((t, ti) => (ti === typIdx
            ? { ...t, configs: t.configs.map((c, ci) => (ci === cfgIdx ? { ...c, [field]: value } : c)) }
            : t))
        }
      : w)));
  }

  const consumoLocal = calcularConsumoLocal(wells, explosiveTypes);

  async function handleSubmit(e) {
    e.preventDefault();
    const cleanWells = wells.filter((w) => w.pozo.trim());
    if (cleanWells.length === 0) {
      setError('Agregá al menos 1 pozo con nombre.');
      return;
    }
    const sinTipo = cleanWells.some((w) => w.typologies.some((t) => t.configs.some((c) => !c.explosive_type_id)));
    if (sinTipo) {
      setError('Todas las configuraciones necesitan un Tipo de Explosivo elegido.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload = {
        fecha, nombre: nombre.trim() || null, cliente_id: clienteId || null, pad: pad.trim() || null,
        wells: cleanWells.map((w) => ({
          pozo: w.pozo, cantidad_etapas: w.cantidad_etapas || null,
          typologies: w.typologies.map((t) => ({ nombre: t.nombre, configs: t.configs }))
        }))
      };
      if (editingProgram) {
        await api.updateExplosiveProgram(editingProgram.id, payload);
      } else {
        await api.createExplosiveProgram(payload);
      }
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ paddingTop: 16, borderTop: '1px solid var(--border)' }}>
      {error && <div className="error-banner">{error}</div>}
      {explosiveTypes.length === 0 && (
        <div className="locked-note" style={{ marginBottom: 14 }}>
          Todavía no hay Tipos de Explosivos cargados — abrí esa sección arriba y agregá al menos uno antes de armar un Programa.
        </div>
      )}

      <div className="form-row">
        <div className="field"><label>Fecha</label><input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} /></div>
        <div className="field"><label>Nombre</label><input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="ej: Programa Julio Pozo X" /></div>
        <div className="field">
          <label>Cliente</label>
          <select value={clienteId} onChange={(e) => setClienteId(e.target.value)}>
            <option value="">Sin cliente</option>
            {clients.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
          </select>
        </div>
        <div className="field"><label>PAD</label><input value={pad} onChange={(e) => setPad(e.target.value)} placeholder="ej: PAD Norte 105" /></div>
      </div>

      {wells.map((well, wIdx) => (
        <div key={wIdx} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 14, marginTop: 16 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: 14 }}>
            <div className="field" style={{ flex: 2, marginBottom: 0 }}>
              <label>Pozo {wIdx + 1}</label>
              <input value={well.pozo} onChange={(e) => updateWellField(wIdx, 'pozo', e.target.value)} placeholder="ej: Pozo-1" />
            </div>
            <div className="field" style={{ flex: 1, marginBottom: 0 }}>
              <label>Cantidad de Etapas</label>
              <input type="number" value={well.cantidad_etapas} onChange={(e) => updateWellField(wIdx, 'cantidad_etapas', e.target.value)} />
            </div>
            {wells.length > 1 && (
              <button type="button" className="btn-secondary btn" style={{ color: 'var(--danger)' }} onClick={() => removeWell(wIdx)}>Quitar pozo</button>
            )}
          </div>

          {well.typologies.map((typology, tIdx) => (
            <div key={tIdx} style={{ background: 'var(--bg-panel-raised)', borderRadius: 6, padding: 14, marginBottom: 12 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: 12 }}>
                <div className="field" style={{ flex: 1, marginBottom: 0 }}>
                  <label>Tipología</label>
                  <input value={typology.nombre} onChange={(e) => updateTypologyNombre(wIdx, tIdx, e.target.value)} placeholder="ej: TIPO A" />
                </div>
                {well.typologies.length > 1 && (
                  <button type="button" className="btn-secondary btn" style={{ color: 'var(--danger)' }} onClick={() => removeTypology(wIdx, tIdx)}>Quitar tipología</button>
                )}
              </div>

              {typology.configs.map((config, cIdx) => (
                <div key={cIdx} style={{ border: '1px solid var(--border)', borderRadius: 6, padding: 12, marginBottom: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                    <span className="locked-note">Configuración {cIdx + 1}</span>
                    {typology.configs.length > 1 && (
                      <button type="button" className="btn-secondary btn" style={{ padding: '2px 8px', fontSize: 11, color: 'var(--danger)' }} onClick={() => removeConfig(wIdx, tIdx, cIdx)}>✕</button>
                    )}
                  </div>
                  <ConfigFields
                    config={config}
                    explosiveTypes={explosiveTypes}
                    onChange={(field, value) => updateConfigField(wIdx, tIdx, cIdx, field, value)}
                  />
                </div>
              ))}
              <button type="button" className="btn-secondary btn" onClick={() => addConfig(wIdx, tIdx)}>+ Nueva Configuración</button>
            </div>
          ))}
          <button type="button" className="btn-secondary btn" onClick={() => addTypology(wIdx)}>+ Nueva Tipología</button>
        </div>
      ))}

      <div style={{ marginTop: 14 }}>
        <button type="button" className="btn-secondary btn" onClick={addWell}>+ Nuevo Pozo</button>
      </div>

      {consumoLocal.length > 0 && (
        <div style={{ marginTop: 20, background: 'var(--bg-panel-raised)', borderRadius: 8, padding: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Consumo total estimado (todo el programa)</div>
          <table className="data-table">
            <thead><tr><th>Tipo de Explosivo</th><th>Cantidad total</th></tr></thead>
            <tbody>
              {consumoLocal.map((c) => (
                <tr key={c.explosive_type_id}><td>{c.descripcion}</td><td className="mono">{c.cantidad}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ marginTop: 20, display: 'flex', gap: 10 }}>
        <button type="submit" className="btn" disabled={saving}>
          {saving ? 'Guardando...' : editingProgram ? 'Guardar cambios' : 'Crear programa'}
        </button>
        {editingProgram && <button type="button" className="btn-secondary btn" onClick={onCancelEdit}>Cancelar edición</button>}
      </div>
    </form>
  );
}

// ================= Componente principal =================
export default function ExplosivesTab({ user }) {
  const canManage = CAN_MANAGE_ROLES.includes(user.role);

  const [clients, setClients] = useState([]);
  const [explosiveTypes, setExplosiveTypes] = useState([]);
  const [programs, setPrograms] = useState([]);
  const [loadingPrograms, setLoadingPrograms] = useState(true);
  const [error, setError] = useState(null);

  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo] = useState('');
  const [filterCliente, setFilterCliente] = useState('');

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingProgram, setEditingProgram] = useState(null);

  useEffect(() => { api.getClients().then(setClients).catch(() => {}); }, []);
  useEffect(() => { loadPrograms(); }, [filterFrom, filterTo, filterCliente]); // eslint-disable-line react-hooks/exhaustive-deps

  function loadPrograms() {
    setLoadingPrograms(true);
    const params = {};
    if (filterFrom) params.from = filterFrom;
    if (filterTo) params.to = filterTo;
    if (filterCliente) params.cliente_id = filterCliente;
    api.getExplosivePrograms(params).then(setPrograms).catch((e) => setError(e.message)).finally(() => setLoadingPrograms(false));
  }

  function toggleCreateForm() {
    if (showCreateForm) {
      setShowCreateForm(false);
      setEditingProgram(null);
    } else {
      setEditingProgram(null);
      setShowCreateForm(true);
    }
  }

  async function openEditProgram(programSummary) {
    setError(null);
    try {
      const full = await api.getExplosiveProgram(programSummary.id);
      setEditingProgram(full);
      setShowCreateForm(true);
    } catch (err) {
      setError(err.message);
    }
  }

  function handleSaved() {
    setShowCreateForm(false);
    setEditingProgram(null);
    loadPrograms();
  }

  async function handleDeleteProgram(id) {
    if (!window.confirm('¿Eliminar este programa de explosivos? Esta accion no se puede deshacer.')) return;
    try {
      await api.deleteExplosiveProgram(id);
      loadPrograms();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div>
      <ExplosiveTypesSection canManage={canManage} onTypesChanged={setExplosiveTypes} />

      {canManage && (
        <div className="panel">
          <div className="panel-title">
            {showCreateForm ? (editingProgram ? 'Editar Programa' : 'Crear Programa') : 'Programa de Explosivos'}
            <button className="btn" onClick={toggleCreateForm}>{showCreateForm ? 'Cerrar' : '+ Crear programa'}</button>
          </div>
          {showCreateForm && (
            <ProgramFormSection
              clients={clients}
              explosiveTypes={explosiveTypes}
              editingProgram={editingProgram}
              onSaved={handleSaved}
              onCancelEdit={toggleCreateForm}
            />
          )}
        </div>
      )}

      <Collapsible title="Programas creados" badge={programs.length}>
        {error && <div className="error-banner">{error}</div>}
        <div className="form-row" style={{ marginBottom: 14 }}>
          <div className="field"><label>Desde</label><input type="date" value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)} /></div>
          <div className="field"><label>Hasta</label><input type="date" value={filterTo} onChange={(e) => setFilterTo(e.target.value)} /></div>
          <div className="field">
            <label>Cliente</label>
            <select value={filterCliente} onChange={(e) => setFilterCliente(e.target.value)}>
              <option value="">Todos</option>
              {clients.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
            </select>
          </div>
        </div>

        {loadingPrograms ? (
          <div className="empty-state">Cargando...</div>
        ) : programs.length === 0 ? (
          <div className="empty-state">No hay programas para estos filtros.</div>
        ) : (
          <table className="data-table">
            <thead><tr><th>Fecha</th><th>Nombre</th><th>Cliente</th><th>PAD</th><th>Pozos</th>{canManage && <th></th>}</tr></thead>
            <tbody>
              {programs.map((p) => (
                <tr key={p.id}>
                  <td className="mono">{p.fecha ? String(p.fecha).slice(0, 10) : '-'}</td>
                  <td>{p.nombre || '-'}</td>
                  <td>{p.cliente_nombre || '-'}</td>
                  <td>{p.pad || '-'}</td>
                  <td>{p.wells.map((w) => `${w.pozo} (${w.cantidad_etapas ?? '?'} et.)`).join(', ')}</td>
                  {canManage && (
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button className="btn-secondary btn" style={{ padding: '4px 8px', fontSize: 11, marginRight: 6 }} onClick={() => openEditProgram(p)}>Editar</button>
                      <button className="btn-secondary btn" style={{ padding: '4px 8px', fontSize: 11, color: 'var(--danger)' }} onClick={() => handleDeleteProgram(p.id)}>Eliminar</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Collapsible>
    </div>
  );
}
