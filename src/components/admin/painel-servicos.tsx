'use client'

import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import type { TransportadoraResumo, ServicoResumo } from '@/server/admin/servicos'

const CAMPO =
  'rounded-lg border border-borda-campo bg-transparent px-3 py-2 text-texto-principal focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand'

const BOTAO =
  'rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-60 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand'

type FormularioServico = {
  id?: string
  carrierId: string
  codigo: string
  nome: string
  prazoBase: number
  limitePesoG: number
  alturaCm: string
  larguraCm: string
  comprimentoCm: string
  exigePudo: boolean
  entregaSabado: boolean
  ativo: boolean
}

function vazio(carrierId: string): FormularioServico {
  return {
    carrierId,
    codigo: '',
    nome: '',
    prazoBase: 5,
    limitePesoG: 30000,
    alturaCm: '',
    larguraCm: '',
    comprimentoCm: '',
    exigePudo: false,
    entregaSabado: false,
    ativo: true,
  }
}

function deServico(servico: ServicoResumo, carrierId: string): FormularioServico {
  return {
    id: servico.id,
    carrierId,
    codigo: servico.codigo,
    nome: servico.nome,
    prazoBase: servico.prazoBase,
    limitePesoG: servico.limitePesoG,
    alturaCm: servico.limiteDimensoes.alturaCm?.toString() ?? '',
    larguraCm: servico.limiteDimensoes.larguraCm?.toString() ?? '',
    comprimentoCm: servico.limiteDimensoes.comprimentoCm?.toString() ?? '',
    exigePudo: servico.exigePudo,
    entregaSabado: servico.entregaSabado,
    ativo: servico.ativo,
  }
}

function numeroOuIndefinido(texto: string): number | undefined {
  const valor = Number(texto.replace(',', '.'))
  return texto.trim() === '' || !Number.isFinite(valor) ? undefined : valor
}

/**
 * Transportadoras e serviços.
 *
 * Não há botão de excluir em lugar nenhum, de propósito: `Service` é
 * referenciado por cotações, envios e regras de preço, e o histórico do
 * cliente aponta para ele. Desativar tira das cotações novas e preserva o
 * passado — a tela mostra quantos envios e quantas regras dependem de cada
 * serviço justamente para que a decisão seja tomada com o número à vista.
 */
export function PainelServicos({
  transportadoras,
}: {
  transportadoras: TransportadoraResumo[]
}) {
  const router = useRouter()
  const [erro, setErro] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [editando, setEditando] = useState<FormularioServico | null>(null)
  const [novaTransportadora, setNovaTransportadora] = useState('')

  async function enviar(corpo: unknown, mensagem: string): Promise<boolean> {
    setErro(null)
    setAviso(null)
    setOcupado(true)
    try {
      const resposta = await fetch('/api/admin/servicos', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(corpo),
      })

      if (!resposta.ok) {
        const dados = (await resposta.json().catch(() => ({}))) as { mensagem?: string }
        setErro(dados.mensagem ?? 'Não foi possível concluir a ação.')
        return false
      }

      setAviso(mensagem)
      router.refresh()
      return true
    } catch {
      setErro('Não foi possível conectar ao servidor. Tente novamente.')
      return false
    } finally {
      setOcupado(false)
    }
  }

  async function salvarServico(formulario: FormularioServico) {
    const ok = await enviar(
      {
        acao: 'SALVAR_SERVICO',
        id: formulario.id,
        carrierId: formulario.carrierId,
        codigo: formulario.codigo,
        nome: formulario.nome,
        prazoBase: formulario.prazoBase,
        limitePesoG: formulario.limitePesoG,
        limiteDimensoes: {
          alturaCm: numeroOuIndefinido(formulario.alturaCm),
          larguraCm: numeroOuIndefinido(formulario.larguraCm),
          comprimentoCm: numeroOuIndefinido(formulario.comprimentoCm),
        },
        exigePudo: formulario.exigePudo,
        entregaSabado: formulario.entregaSabado,
        ativo: formulario.ativo,
      },
      formulario.id ? 'Serviço atualizado.' : 'Serviço criado.',
    )
    if (ok) setEditando(null)
  }

  return (
    <>
      {erro ? (
        <p role="alert" className="rounded-lg bg-superficie-card p-4 text-sm text-erro">
          {erro}
        </p>
      ) : null}
      {aviso ? (
        <p role="status" className="rounded-lg bg-superficie-card p-4 text-sm text-texto-principal">
          {aviso}
        </p>
      ) : null}

      <section className="flex flex-col gap-3 rounded-xl bg-superficie-card p-6">
        <h2 className="text-lg font-bold text-texto-principal">Nova transportadora</h2>
        <form
          onSubmit={async (evento: FormEvent<HTMLFormElement>) => {
            evento.preventDefault()
            const ok = await enviar(
              { acao: 'SALVAR_TRANSPORTADORA', nome: novaTransportadora },
              'Transportadora criada.',
            )
            if (ok) setNovaTransportadora('')
          }}
          className="flex flex-wrap items-end gap-3"
        >
          <label className="flex min-w-[16rem] flex-1 flex-col gap-1 text-sm">
            <span className="text-texto-secundario">Nome</span>
            <input
              type="text"
              value={novaTransportadora}
              onChange={(evento) => setNovaTransportadora(evento.target.value)}
              className={CAMPO}
            />
          </label>
          <button type="submit" disabled={ocupado} className={`${BOTAO} bg-brand text-white`}>
            {ocupado ? 'Salvando…' : 'Criar'}
          </button>
        </form>
      </section>

      {transportadoras.map((transportadora) => (
        <section
          key={transportadora.id}
          className="flex flex-col gap-4 rounded-xl bg-superficie-card p-6"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-texto-principal">
                {transportadora.nome}
                {!transportadora.ativo ? (
                  <span className="ml-2 rounded-pilula bg-borda-campo px-2 py-0.5 text-xs font-medium text-texto-secundario">
                    desativada
                  </span>
                ) : null}
              </h2>
              <p className="text-xs text-texto-secundario">
                {transportadora.slug} · {transportadora.servicos.length} serviço(s)
              </p>
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                disabled={ocupado}
                onClick={() =>
                  enviar(
                    {
                      acao: 'ALTERNAR',
                      alvo: 'TRANSPORTADORA',
                      id: transportadora.id,
                      ativo: !transportadora.ativo,
                    },
                    transportadora.ativo
                      ? 'Transportadora desativada: os serviços dela saem das cotações novas.'
                      : 'Transportadora ativada.',
                  )
                }
                className={`${BOTAO} border border-borda-campo text-texto-principal`}
              >
                {transportadora.ativo ? 'Desativar' : 'Ativar'}
              </button>
              <button
                type="button"
                disabled={ocupado}
                onClick={() => setEditando(vazio(transportadora.id))}
                className={`${BOTAO} bg-brand text-white`}
              >
                Novo serviço
              </button>
            </div>
          </div>

          {transportadora.servicos.length === 0 ? (
            <p className="text-sm text-texto-secundario">Nenhum serviço nesta transportadora.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[56rem] text-left text-sm">
                <thead className="text-xs uppercase text-texto-secundario">
                  <tr>
                    <th scope="col" className="py-2 pr-4">Código</th>
                    <th scope="col" className="py-2 pr-4">Nome</th>
                    <th scope="col" className="py-2 pr-4">Prazo</th>
                    <th scope="col" className="py-2 pr-4">Peso máx.</th>
                    <th scope="col" className="py-2 pr-4">Dimensões</th>
                    <th scope="col" className="py-2 pr-4">Regras</th>
                    <th scope="col" className="py-2 pr-4">Envios</th>
                    <th scope="col" className="py-2">Ações</th>
                  </tr>
                </thead>
                <tbody className="text-texto-principal">
                  {transportadora.servicos.map((servico) => (
                    <tr key={servico.id} className="border-t border-borda-campo">
                      <td className="py-2 pr-4 font-medium">{servico.codigo}</td>
                      <td className="py-2 pr-4">
                        {servico.nome}
                        {!servico.ativo ? (
                          <span className="ml-2 text-xs text-texto-secundario">(desativado)</span>
                        ) : null}
                      </td>
                      <td className="py-2 pr-4">{servico.prazoBase} dia(s)</td>
                      <td className="py-2 pr-4">
                        {(servico.limitePesoG / 1000).toLocaleString('pt-BR')} kg
                      </td>
                      <td className="py-2 pr-4">
                        {servico.limiteDimensoes.alturaCm
                          ? `${servico.limiteDimensoes.alturaCm}×${servico.limiteDimensoes.larguraCm ?? '?'}×${servico.limiteDimensoes.comprimentoCm ?? '?'} cm`
                          : '—'}
                      </td>
                      <td className="py-2 pr-4">{servico.regrasVigentes}</td>
                      <td className="py-2 pr-4">{servico.envios}</td>
                      <td className="py-2">
                        <div className="flex gap-3">
                          <button
                            type="button"
                            disabled={ocupado}
                            onClick={() => setEditando(deServico(servico, transportadora.id))}
                            className="text-sm font-medium text-brand-texto disabled:opacity-60 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
                          >
                            Editar
                          </button>
                          <button
                            type="button"
                            disabled={ocupado}
                            onClick={() =>
                              enviar(
                                {
                                  acao: 'ALTERNAR',
                                  alvo: 'SERVICO',
                                  id: servico.id,
                                  ativo: !servico.ativo,
                                },
                                servico.ativo
                                  ? `Serviço ${servico.codigo} desativado: sai das cotações novas, os ${servico.envios} envio(s) existentes não mudam.`
                                  : `Serviço ${servico.codigo} ativado.`,
                              )
                            }
                            className="text-sm font-medium text-texto-secundario disabled:opacity-60 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
                          >
                            {servico.ativo ? 'Desativar' : 'Ativar'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ))}

      {editando ? (
        <ServicoForm
          formulario={editando}
          ocupado={ocupado}
          aoCancelar={() => setEditando(null)}
          aoSalvar={salvarServico}
        />
      ) : null}
    </>
  )
}

function ServicoForm({
  formulario,
  ocupado,
  aoCancelar,
  aoSalvar,
}: {
  formulario: FormularioServico
  ocupado: boolean
  aoCancelar: () => void
  aoSalvar: (formulario: FormularioServico) => Promise<void>
}) {
  const [estado, setEstado] = useState(formulario)

  function campo<K extends keyof FormularioServico>(chave: K, valor: FormularioServico[K]) {
    setEstado((atual) => ({ ...atual, [chave]: valor }))
  }

  return (
    <section className="flex flex-col gap-4 rounded-xl bg-superficie-card p-6">
      <h2 className="text-lg font-bold text-texto-principal">
        {estado.id ? `Editar serviço ${estado.codigo}` : 'Novo serviço'}
      </h2>

      <form
        onSubmit={(evento: FormEvent<HTMLFormElement>) => {
          evento.preventDefault()
          void aoSalvar(estado)
        }}
        className="flex flex-col gap-4"
      >
        <div className="flex flex-wrap gap-3">
          <label className="flex w-40 flex-col gap-1 text-sm">
            <span className="text-texto-secundario">Código</span>
            <input
              type="text"
              value={estado.codigo}
              onChange={(evento) => campo('codigo', evento.target.value)}
              className={CAMPO}
            />
          </label>

          <label className="flex min-w-[14rem] flex-1 flex-col gap-1 text-sm">
            <span className="text-texto-secundario">Nome</span>
            <input
              type="text"
              value={estado.nome}
              onChange={(evento) => campo('nome', evento.target.value)}
              className={CAMPO}
            />
          </label>

          <label className="flex w-36 flex-col gap-1 text-sm">
            <span className="text-texto-secundario">Prazo (dias)</span>
            <input
              type="number"
              min={1}
              max={120}
              value={estado.prazoBase}
              onChange={(evento) => campo('prazoBase', Number(evento.target.value))}
              className={CAMPO}
            />
          </label>

          <label className="flex w-40 flex-col gap-1 text-sm">
            <span className="text-texto-secundario">Peso máximo (g)</span>
            <input
              type="number"
              min={1}
              max={100000}
              value={estado.limitePesoG}
              onChange={(evento) => campo('limitePesoG', Number(evento.target.value))}
              className={CAMPO}
            />
          </label>
        </div>

        <fieldset className="flex flex-wrap items-end gap-3">
          <legend className="text-xs uppercase text-texto-secundario">
            Dimensões máximas (cm, opcionais)
          </legend>
          {(
            [
              ['Altura', 'alturaCm'],
              ['Largura', 'larguraCm'],
              ['Comprimento', 'comprimentoCm'],
            ] as const
          ).map(([rotulo, chave]) => (
            <label key={chave} className="flex w-32 flex-col gap-1 text-sm">
              <span className="text-texto-secundario">{rotulo}</span>
              <input
                type="text"
                inputMode="decimal"
                value={estado[chave]}
                onChange={(evento) => campo(chave, evento.target.value)}
                className={CAMPO}
              />
            </label>
          ))}
        </fieldset>

        <div className="flex flex-wrap gap-4 text-sm text-texto-principal">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={estado.exigePudo}
              onChange={(evento) => campo('exigePudo', evento.target.checked)}
            />
            Exige ponto de postagem
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={estado.entregaSabado}
              onChange={(evento) => campo('entregaSabado', evento.target.checked)}
            />
            Entrega aos sábados
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={estado.ativo}
              onChange={(evento) => campo('ativo', evento.target.checked)}
            />
            Ativo (aparece nas cotações novas)
          </label>
        </div>

        <p className="text-sm text-texto-secundario">
          Mudar o prazo vale para <strong>emissões novas</strong>. A linha do tempo de um envio já
          emitido está gravada com as datas calculadas na emissão e não se move — o que muda é o
          prazo exibido na listagem de etiquetas, que lê o serviço atual.
        </p>

        <div className="flex gap-3">
          <button type="submit" disabled={ocupado} className={`${BOTAO} bg-brand text-white`}>
            {ocupado ? 'Salvando…' : 'Salvar serviço'}
          </button>
          <button
            type="button"
            onClick={aoCancelar}
            className={`${BOTAO} border border-borda-campo text-texto-principal`}
          >
            Cancelar
          </button>
        </div>
      </form>
    </section>
  )
}
