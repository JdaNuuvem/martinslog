import type { ReactNode } from 'react'

export type Coluna = {
  /** Cabeçalho no desktop e rótulo do campo no celular. */
  rotulo: string
  /**
   * Campo que carrega a identidade da linha (o número do pedido, o
   * destinatário). No celular ele vira o título do cartão, sem rótulo.
   */
  principal?: boolean
  /** Esconde no celular o que só serve para varrer a tabela no desktop. */
  soDesktop?: boolean
}

export type Linha = {
  chave: string
  celulas: ReactNode[]
}

/**
 * Uma lista, dois formatos.
 *
 * No desktop, tabela: sete colunas alinhadas é o que deixa varrer duzentas
 * linhas procurando a que está errada. No celular, a mesma tabela vira uma
 * régua horizontal de 50rem — e a informação que importa fica fora da tela.
 *
 * Então abaixo de `lg` cada linha vira um cartão com os campos empilhados e
 * rotulados. É o mesmo dado, montado uma vez só: as células chegam prontas e
 * são reaproveitadas nos dois desenhos, sem duplicar a lógica de formatação.
 */
export function TabelaResponsiva({
  colunas,
  linhas,
  vazio = 'Nada por aqui.',
}: {
  colunas: Coluna[]
  linhas: Linha[]
  vazio?: string
}) {
  if (linhas.length === 0) {
    return <p className="text-corpo text-texto-secundario">{vazio}</p>
  }

  return (
    <>
      <div className="hidden overflow-x-auto lg:block">
        <table className="w-full border-collapse text-dado">
          <thead>
            <tr className="border-b border-borda text-left text-texto-secundario">
              {colunas.map((coluna) => (
                <th key={coluna.rotulo} className="px-2 py-3 font-medium">
                  {coluna.rotulo}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {linhas.map((linha) => (
              <tr key={linha.chave} className="border-b border-borda/50 align-top">
                {linha.celulas.map((celula, indice) => (
                  <td key={colunas[indice]?.rotulo ?? indice} className="px-2 py-3">
                    {celula}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="flex flex-col gap-3 lg:hidden">
        {linhas.map((linha) => (
          <li
            key={linha.chave}
            className="flex flex-col gap-2 rounded-lg border border-borda p-4 text-dado"
          >
            {linha.celulas.map((celula, indice) => {
              const coluna = colunas[indice]
              if (!coluna || coluna.soDesktop) return null

              if (coluna.principal) {
                return (
                  <div key={coluna.rotulo} className="text-corpo font-semibold text-texto-principal">
                    {celula}
                  </div>
                )
              }

              return (
                /*
                  `min-w-0` no valor: sem ele, um erro de provedor sem espaços
                  estica o cartão e traz de volta a régua horizontal que este
                  desenho existe para evitar.
                */
                <div key={coluna.rotulo} className="flex justify-between gap-4">
                  <span className="shrink-0 text-texto-secundario">{coluna.rotulo}</span>
                  <span className="min-w-0 break-words text-right text-texto-principal">
                    {celula}
                  </span>
                </div>
              )
            })}
          </li>
        ))}
      </ul>
    </>
  )
}
