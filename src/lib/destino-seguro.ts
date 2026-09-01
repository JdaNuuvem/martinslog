/**
 * Normaliza o destino pós-login vindo da URL (`/login?destino=...`).
 *
 * O valor chega de um parâmetro de consulta, ou seja, de fora: quem monta o
 * link decide o conteúdo. Redirecionar sem filtrar transforma a tela de
 * login em trampolim — `?destino=https://sitedephishing/` levaria o usuário
 * para fora logo depois de digitar a senha, com a credibilidade do nosso
 * domínio emprestada ao golpe.
 *
 * Por isso só passa caminho interno: começa com uma barra e não com duas.
 * `//outro.site` é endereço absoluto de protocolo relativo, e o navegador o
 * trata como externo — a segunda barra é a armadilha que a checagem ingênua
 * de "começa com /" deixa passar. Barra invertida entra na mesma regra
 * porque alguns navegadores a normalizam para barra.
 *
 * Qualquer coisa fora disso vira a home, que é para onde o login sempre
 * levou.
 */
export const DESTINO_PADRAO = '/'

export function destinoSeguro(valor: string | null | undefined): string {
  if (!valor) return DESTINO_PADRAO
  if (!valor.startsWith('/')) return DESTINO_PADRAO
  if (valor.startsWith('//') || valor.startsWith('/\\')) return DESTINO_PADRAO
  return valor
}
