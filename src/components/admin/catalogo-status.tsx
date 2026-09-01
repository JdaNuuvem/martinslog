'use client'

import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'

export type LinhaCatalogo = {
  id: string
  codigo: string
  titulo: string
  descricao: string
  cenario: string | null
  fracaoPrazo: number | null
  diasAposEmissao: number | null
  statusResultante: string | null
  ativo: boolean
}

const CENARIOS = ['ENTREGA_NORMAL', 'ATRASO', 'TENTATIVA_FALHA', 'EXTRAVIO', 'DEVOLUCAO'] as const

/**
 * Status resultantes oferecidos a uma etapa criada à mão.
 *
 * Só os intermediários: um evento do meio do caminho que resultasse em
 * `DELIVERED` ou `LOST` encerraria o envio ali, e os eventos seguintes
 * ficariam sem transição possível. O servidor recusa de qualquer forma; a
 * lista curta evita oferecer o que vai ser recusado.
 */
const STATUS_INTERMEDIARIOS = ['GENERATED', 'POSTED'] as const

const CAMPO =
  'rounded-lg border border-borda-campo bg-transparent px-3 py-2 text-texto-principal focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand'

function posicaoLegivel(linha: LinhaCatalogo): string {
  if (linha.diasAposEmissao !== null) {
    const dias = linha.diasAposEmissao
    return `dia ${dias.toLocaleString('pt-BR')}`
  }
  if (linha.fracaoPrazo !== null) {
    return `${(linha.fracaoPrazo * 100).toLocaleString('pt-BR')}% do prazo`
  }
  return 'posição do motor'
}

/**
 * Catálogo padrão em duas abas.
 *
 * **Automático** é o fluxo que o motor já gera sozinho: aqui se reescreve o
 * texto de cada etapa e se muda *quando* ela acontece — inclusive pela
 * cadência fixa, o "a cada X dias muda o status".
 *
 * **Manual** são as etapas que não existem no motor e passam a existir porque
 * alguém as criou: exigem cenário, posição e o status de envio que produzem.
 *
 * A divisão não é cosmética: reposicionar uma etapa do motor é seguro, criar
 * uma nova pode tornar a linha do tempo impossível, e as duas ações merecem
 * telas com pesos diferentes.
 */
export function CatalogoStatus({
  linhas,
  codigosDoMotor,
  fatorVelocidade,
}: {
  linhas: LinhaCatalogo[]
  codigosDoMotor: string[]
  fatorVelocidade: number
}) {
  const router = useRouter()
  const [aba, setAba] = useState<'automatico' | 'manual'>('automatico')
  const [erro, setErro] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)

  const doMotor = linhas.filter((linha) => codigosDoMotor.includes(linha.codigo))
  const manuais = linhas.filter((linha) => !codigosDoMotor.includes(linha.codigo))

  async function enviar(corpo: unknown): Promise<boolean> {
    setErro(null)
    setAviso(null)
    setOcupado(true)
    try {
      const resposta = await fetch('/api/admin/status-rastreio', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(corpo),
      })

      if (!resposta.ok) {
        const dados = (await resposta.json().catch(() => ({}))) as { mensagem?: string }
        setErro(dados.mensagem ?? 'Não foi possível salvar.')
        return false
      }

      router.refresh()
      return true
    } catch {
      setErro('Não foi possível conectar ao servidor. Tente novamente.')
      return false
    } finally {
      setOcupado(false)
    }
  }

  return (
    <>
      <nav aria-label="Seções do catálogo" className="flex gap-2">
        {(
          [
            ['automatico', 'Automático (fluxo do motor)'],
            ['manual', `Manual (${manuais.length})`],
          ] as const
        ).map(([valor, rotulo]) => (
          <button
            key={valor}
            type="button"
            onClick={() => setAba(valor)}
            aria-pressed={aba === valor}
            className={`rounded-pilula px-3 py-1.5 text-sm focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand ${
              aba === valor ? 'bg-brand text-white' : 'bg-superficie-card text-texto-principal'
            }`}
          >
            {rotulo}
          </button>
        ))}
      </nav>

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

      {aba === 'automatico' ? (
        <>
          <CadenciaForm
            ocupado={ocupado}
            fatorVelocidade={fatorVelocidade}
            aoAplicar={async (dias) => {
              const ok = await enviar({ acao: 'CADENCIA', dias })
              if (ok) {
                setAviso(
                  dias === 0
                    ? 'Cadência desfeita: o fluxo voltou às frações do prazo de cada serviço.'
                    : `Cadência aplicada: uma etapa a cada ${dias} dia(s) nos envios novos.`,
                )
              }
            }}
          />

          <section className="flex flex-col gap-4 rounded-xl bg-superficie-card p-6">
            <div>
              <h2 className="text-subtitulo font-semibold text-texto-principal">Etapas do fluxo automático</h2>
              <p className="text-sm text-texto-secundario">
                Um código sem linha aqui usa o texto e a posição embutidos no motor. Salvar cria a
                linha e passa a valer para todas as contas que não personalizaram aquele código.
              </p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[52rem] text-left text-dado">
                <thead className="text-rotulo uppercase text-texto-secundario">
                  <tr>
                    <th scope="col" className="py-2 pr-4">Código</th>
                    <th scope="col" className="py-2 pr-4">Título</th>
                    <th scope="col" className="py-2 pr-4">Posição</th>
                    <th scope="col" className="py-2">Situação</th>
                  </tr>
                </thead>
                <tbody className="text-texto-principal">
                  {codigosDoMotor.map((codigo) => {
                    const linha = doMotor.find((item) => item.codigo === codigo)
                    return (
                      <tr key={codigo} className="border-t border-borda-campo">
                        <td className="py-2 pr-4 font-medium">{codigo}</td>
                        <td className="py-2 pr-4">{linha?.titulo ?? '(texto do motor)'}</td>
                        <td className="py-2 pr-4">
                          {linha ? posicaoLegivel(linha) : 'posição do motor'}
                        </td>
                        <td className="py-2">
                          {linha?.ativo === false ? 'desativada' : 'em uso'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <EtapaMotorForm
              codigos={codigosDoMotor}
              linhas={doMotor}
              ocupado={ocupado}
              aoSalvar={async (corpo) => {
                const ok = await enviar(corpo)
                if (ok) setAviso('Etapa do fluxo automático atualizada.')
              }}
            />
          </section>
        </>
      ) : (
        <section className="flex flex-col gap-4 rounded-xl bg-superficie-card p-6">
          <div>
            <h2 className="text-subtitulo font-semibold text-texto-principal">Status manuais</h2>
            <p className="text-sm text-texto-secundario">
              Etapas que não existem no motor. Entram no roteiro do cenário escolhido, na posição
              indicada, e produzem o status de envio informado.
            </p>
          </div>

          {manuais.length === 0 ? (
            <p className="text-sm text-texto-secundario">Nenhum status manual criado.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[56rem] text-left text-dado">
                <thead className="text-rotulo uppercase text-texto-secundario">
                  <tr>
                    <th scope="col" className="py-2 pr-4">Código</th>
                    <th scope="col" className="py-2 pr-4">Título</th>
                    <th scope="col" className="py-2 pr-4">Cenário</th>
                    <th scope="col" className="py-2 pr-4">Posição</th>
                    <th scope="col" className="py-2 pr-4">Vira</th>
                    <th scope="col" className="py-2">Ações</th>
                  </tr>
                </thead>
                <tbody className="text-texto-principal">
                  {manuais.map((linha) => (
                    <tr key={linha.id} className="border-t border-borda-campo">
                      <td className="py-2 pr-4 font-medium">{linha.codigo}</td>
                      <td className="py-2 pr-4">{linha.titulo}</td>
                      <td className="py-2 pr-4">{linha.cenario ?? '—'}</td>
                      <td className="py-2 pr-4">{posicaoLegivel(linha)}</td>
                      <td className="py-2 pr-4">{linha.statusResultante ?? '—'}</td>
                      <td className="py-2">
                        <button
                          type="button"
                          disabled={ocupado}
                          onClick={async () => {
                            if (!window.confirm(`Remover o status ${linha.codigo}?`)) return
                            const ok = await enviar({ acao: 'REMOVER', id: linha.id })
                            if (ok) setAviso(`Status ${linha.codigo} removido.`)
                          }}
                          className="text-sm font-medium text-erro disabled:opacity-60 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
                        >
                          Remover
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <StatusManualForm
            ocupado={ocupado}
            aoSalvar={async (corpo) => {
              const ok = await enviar(corpo)
              if (ok) setAviso('Status manual salvo.')
            }}
          />
        </section>
      )}
    </>
  )
}

/** "A cada X dias muda o status" — a cadência fixa do fluxo principal. */
function CadenciaForm({
  ocupado,
  fatorVelocidade,
  aoAplicar,
}: {
  ocupado: boolean
  fatorVelocidade: number
  aoAplicar: (dias: number) => Promise<void>
}) {
  const [dias, setDias] = useState(2)

  const minutosReais = Math.round((dias * 24 * 60) / fatorVelocidade)

  return (
    <section className="flex flex-col gap-4 rounded-xl bg-superficie-card p-6">
      <div>
        <h2 className="text-subtitulo font-semibold text-texto-principal">Cadência fixa</h2>
        <p className="text-sm text-texto-secundario">
          Espaça as etapas do caminho normal — emissão, postagem, transferência, saída para
          entrega, entrega — de X em X dias, ignorando o prazo do serviço. As etapas exclusivas de
          cenário (tentativa frustrada, extravio, devolução) continuam pelo prazo, porque forçá-las
          na mesma régua produziria uma devolução antes da tentativa que a causou.
        </p>
      </div>

      <form
        onSubmit={(evento: FormEvent<HTMLFormElement>) => {
          evento.preventDefault()
          void aoAplicar(dias)
        }}
        className="flex flex-wrap items-end gap-3"
      >
        <label className="flex w-40 flex-col gap-1 text-sm">
          <span className="text-texto-secundario">Dias entre etapas</span>
          <input
            type="number"
            min={0}
            max={90}
            step="0.5"
            value={dias}
            onChange={(evento) => setDias(Number(evento.target.value))}
            className={CAMPO}
          />
        </label>

        <p className="pb-2 text-sm text-texto-secundario">
          Com o fator de velocidade atual ({fatorVelocidade}×), {dias} dia(s) de simulação levam{' '}
          <strong>{minutosReais} minuto(s)</strong> de relógio real.
        </p>

        <button
          type="submit"
          disabled={ocupado}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-60 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
        >
          {ocupado ? 'Aplicando…' : 'Aplicar cadência'}
        </button>
        <button
          type="button"
          disabled={ocupado}
          onClick={() => void aoAplicar(0)}
          className="rounded-lg border border-borda-campo px-4 py-2 text-sm text-texto-principal disabled:opacity-60 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
        >
          Voltar ao prazo do serviço
        </button>
      </form>
    </section>
  )
}

/** Edição de uma etapa que o motor já gera: texto e posição. */
function EtapaMotorForm({
  codigos,
  linhas,
  ocupado,
  aoSalvar,
}: {
  codigos: string[]
  linhas: LinhaCatalogo[]
  ocupado: boolean
  aoSalvar: (corpo: unknown) => Promise<void>
}) {
  const [codigo, setCodigo] = useState(codigos[0] ?? '')
  const atual = linhas.find((linha) => linha.codigo === codigo)
  const [titulo, setTitulo] = useState('')
  const [descricao, setDescricao] = useState('')
  const [dias, setDias] = useState('')

  function selecionar(novo: string) {
    setCodigo(novo)
    const linha = linhas.find((item) => item.codigo === novo)
    setTitulo(linha?.titulo ?? '')
    setDescricao(linha?.descricao ?? '')
    setDias(linha?.diasAposEmissao !== null && linha ? String(linha.diasAposEmissao) : '')
  }

  return (
    <form
      onSubmit={(evento: FormEvent<HTMLFormElement>) => {
        evento.preventDefault()
        void aoSalvar({
          acao: 'SALVAR',
          nome: codigo,
          titulo,
          descricao,
          diasAposEmissao: dias.trim() === '' ? null : Number(dias.replace(',', '.')),
        })
      }}
      className="flex flex-col gap-3 border-t border-borda-campo pt-4"
    >
      <h3 className="text-corpo font-semibold text-texto-principal">Editar etapa do motor</h3>

      <div className="flex flex-wrap gap-3">
        <label className="flex w-56 flex-col gap-1 text-sm">
          <span className="text-texto-secundario">Código</span>
          <select value={codigo} onChange={(e) => selecionar(e.target.value)} className={CAMPO}>
            {codigos.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>

        <label className="flex min-w-[14rem] flex-1 flex-col gap-1 text-sm">
          <span className="text-texto-secundario">Título</span>
          <input
            type="text"
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            placeholder={atual?.titulo ?? 'texto do motor'}
            className={CAMPO}
          />
        </label>

        <label className="flex w-40 flex-col gap-1 text-sm">
          <span className="text-texto-secundario">Dia (vazio = prazo)</span>
          <input
            type="text"
            inputMode="decimal"
            value={dias}
            onChange={(e) => setDias(e.target.value)}
            placeholder="ex.: 2"
            className={CAMPO}
          />
        </label>
      </div>

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-texto-secundario">Descrição</span>
        <input
          type="text"
          value={descricao}
          onChange={(e) => setDescricao(e.target.value)}
          placeholder={atual?.descricao ?? 'texto do motor'}
          className={CAMPO}
        />
      </label>

      <button
        type="submit"
        disabled={ocupado}
        className="w-fit rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-60 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
      >
        {ocupado ? 'Salvando…' : 'Salvar etapa'}
      </button>
    </form>
  )
}

/** Criação de uma etapa que não existe no motor. */
function StatusManualForm({
  ocupado,
  aoSalvar,
}: {
  ocupado: boolean
  aoSalvar: (corpo: unknown) => Promise<void>
}) {
  const [nome, setNome] = useState('')
  const [titulo, setTitulo] = useState('')
  const [descricao, setDescricao] = useState('')
  const [cenario, setCenario] = useState<string>('ENTREGA_NORMAL')
  const [statusResultante, setStatusResultante] = useState<string>('POSTED')
  const [modo, setModo] = useState<'dias' | 'fracao'>('dias')
  const [posicao, setPosicao] = useState('1')

  return (
    <form
      onSubmit={(evento: FormEvent<HTMLFormElement>) => {
        evento.preventDefault()
        const numero = Number(posicao.replace(',', '.'))
        void aoSalvar({
          acao: 'SALVAR',
          nome,
          titulo,
          descricao,
          cenario,
          statusResultante,
          diasAposEmissao: modo === 'dias' ? numero : null,
          fracaoPrazo: modo === 'fracao' ? numero : null,
        })
      }}
      className="flex flex-col gap-3 border-t border-borda-campo pt-4"
    >
      <h3 className="text-corpo font-semibold text-texto-principal">Novo status manual</h3>

      <div className="flex flex-wrap gap-3">
        <label className="flex w-56 flex-col gap-1 text-sm">
          <span className="text-texto-secundario">Nome</span>
          <input
            type="text"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="Em conferência"
            className={CAMPO}
          />
        </label>

        <label className="flex w-48 flex-col gap-1 text-sm">
          <span className="text-texto-secundario">Cenário</span>
          <select value={cenario} onChange={(e) => setCenario(e.target.value)} className={CAMPO}>
            {CENARIOS.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>

        <label className="flex w-44 flex-col gap-1 text-sm">
          <span className="text-texto-secundario">Vira o status</span>
          <select
            value={statusResultante}
            onChange={(e) => setStatusResultante(e.target.value)}
            className={CAMPO}
          >
            {STATUS_INTERMEDIARIOS.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>

        <label className="flex w-40 flex-col gap-1 text-sm">
          <span className="text-texto-secundario">Posicionar por</span>
          <select
            value={modo}
            onChange={(e) => setModo(e.target.value as 'dias' | 'fracao')}
            className={CAMPO}
          >
            <option value="dias">Dias após a emissão</option>
            <option value="fracao">Fração do prazo</option>
          </select>
        </label>

        <label className="flex w-32 flex-col gap-1 text-sm">
          <span className="text-texto-secundario">{modo === 'dias' ? 'Dia' : 'Fração'}</span>
          <input
            type="text"
            inputMode="decimal"
            value={posicao}
            onChange={(e) => setPosicao(e.target.value)}
            placeholder={modo === 'dias' ? '2' : '0,4'}
            className={CAMPO}
          />
        </label>
      </div>

      <div className="flex flex-wrap gap-3">
        <label className="flex min-w-[14rem] flex-1 flex-col gap-1 text-sm">
          <span className="text-texto-secundario">Título</span>
          <input
            type="text"
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            className={CAMPO}
          />
        </label>
        <label className="flex min-w-[18rem] flex-1 flex-col gap-1 text-sm">
          <span className="text-texto-secundario">Descrição</span>
          <input
            type="text"
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            className={CAMPO}
          />
        </label>
      </div>

      <button
        type="submit"
        disabled={ocupado}
        className="w-fit rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-60 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
      >
        {ocupado ? 'Salvando…' : 'Salvar status manual'}
      </button>
    </form>
  )
}
