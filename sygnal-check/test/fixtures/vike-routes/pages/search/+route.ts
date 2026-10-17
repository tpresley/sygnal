// a Route Function: the route is decided at run time
export default (pageContext: { urlPathname: string }) => pageContext.urlPathname.startsWith('/find')
