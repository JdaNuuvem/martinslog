'use client'

import { memo } from 'react'
import type { Mensagem } from './api'
import { horaMinuto } from './formatadores'
import { ConteudoMensagem } from './conteudo-mensagem'
import { IconeCheck, IconeCheckDuplo, IconeRelogio } from './icones'

type BalaoProps = {
  mensagem: Mensagem
  termo: string
  destacada: boolean
  /** Primeira de uma sequência do mesmo lado: é a que ganha o "rabinho" do balão. */
  inicioDaSequencia: boolean
  podeTentarDeNovo: boolean
  aoTentarDeNovo: (id: string) => void
  aoAbrirImagem: (url: string, legenda: string | null) => void
}

const ROTULO_STATUS: Record<Mensagem['status'], string> = {
  ENVIANDO: 'Enviando',
  ENVIADA: 'Enviada',
  ENTREGUE: 'Entregue',
  LIDA: 'Lida',
  ERRO: 'Não enviada',
}

function IconeStatus({ status }: { status: Mensagem['status'] }) {
  const props = { width: 16, height: 16, role: 'img', 'aria-hidden': false, 'aria-label': ROTULO_STATUS[status] }
  switch (status) {
    case 'ENVIANDO':
      return <IconeRelogio {...props} className="text-[#667781]" />
    case 'ENVIADA':
      return <IconeCheck {...props} className="text-[#667781]" />
    case 'ENTREGUE':
      return <IconeCheckDuplo {...props} className="text-[#667781]" />
    case 'LIDA':
      // O azul dos tiques do próprio WhatsApp: sobre o verde do balão de
      // saída é o contraste que o atendente já sabe ler como "visualizou".
      return <IconeCheckDuplo {...props} className="text-[#53bdeb]" />
    case 'ERRO':
      return (
        <span role="img" aria-label={ROTULO_STATUS.ERRO} className="font-bold text-erro">
          !
        </span>
      )
  }
}

/** O "rabinho" do balão, no canto de cima, como no WhatsApp. */
function Rabinho({ doCliente }: { doCliente: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 8 13"
      width="8"
      height="13"
      className={`absolute top-0 ${doCliente ? '-left-2 text-white' : '-right-2 text-[#d9fdd3]'}`}
    >
      <path
        fill="currentColor"
        d={
          doCliente
            ? 'M1.533 3.568 8 12.193V1H2.812C1.042 1 .474 2.156 1.533 3.568Z'
            : 'M6.467 3.568 0 12.193V1h5.188C6.958 1 7.526 2.156 6.467 3.568Z'
        }
      />
    </svg>
  )
}

/**
 * Um balão da conversa, no desenho do WhatsApp: cliente à esquerda em branco;
 * loja (atendente ou robô) à direita em verde. O lado e a cor dizem de quem é
 * sem precisar ler nada.
 *
 * `memo` porque a consulta periódica recria a lista a cada 5 s e uma conversa
 * longa tem centenas de balões; só o que mudou de verdade re-renderiza.
 */
export const BalaoMensagem = memo(function BalaoMensagem({
  mensagem,
  termo,
  destacada,
  inicioDaSequencia,
  podeTentarDeNovo,
  aoTentarDeNovo,
  aoAbrirImagem,
}: BalaoProps) {
  const doCliente = mensagem.autor === 'CLIENTE'
  const semFundo = Boolean(mensagem.tipo === 'FIGURINHA' && mensagem.midia)
  const comRabinho = inicioDaSequencia && !semFundo

  return (
    <div
      data-mensagem-id={mensagem.id}
      className={`flex w-full ${doCliente ? 'justify-start' : 'justify-end'} ${inicioDaSequencia ? 'mt-2.5' : 'mt-0.5'}`}
    >
      <div
        className={`relative flex max-w-[85%] flex-col rounded-lg px-2 pb-1.5 pt-1.5 sm:max-w-[65%] ${
          semFundo
            ? 'bg-transparent'
            : `${doCliente ? 'bg-white' : 'bg-[#d9fdd3]'} shadow-[0_1px_0.5px_rgba(11,20,26,0.13)]`
        } ${comRabinho ? (doCliente ? 'rounded-tl-none' : 'rounded-tr-none') : ''} ${
          destacada ? 'outline outline-2 outline-alerta' : ''
        }`}
      >
        {comRabinho ? <Rabinho doCliente={doCliente} /> : null}

        {mensagem.autor === 'ROBO' ? (
          <span className="px-1 text-[0.8rem] font-medium leading-5 text-[#027eb5]">Robô</span>
        ) : null}

        <div className="px-1">
          <ConteudoMensagem mensagem={mensagem} termo={termo} aoAbrirImagem={aoAbrirImagem} />
        </div>

        <span className="-mt-0.5 flex items-center justify-end gap-1 self-end pl-6 pr-1 text-[0.6875rem] leading-4 text-[#667781]">
          <time dateTime={mensagem.ocorridoEm}>{horaMinuto(mensagem.ocorridoEm)}</time>
          {doCliente ? null : <IconeStatus status={mensagem.status} />}
        </span>

        {mensagem.status === 'ERRO' ? (
          <span className="flex flex-wrap items-center gap-2 px-1 pt-0.5 text-rotulo text-erro">
            <span>{mensagem.erro ?? 'Não foi possível enviar.'}</span>
            {podeTentarDeNovo ? (
              <button
                type="button"
                onClick={() => aoTentarDeNovo(mensagem.id)}
                className="font-bold underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
              >
                Tentar de novo
              </button>
            ) : null}
          </span>
        ) : null}
      </div>
    </div>
  )
})
